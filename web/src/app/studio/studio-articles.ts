import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ArticleRow, ArticleStatus, ContentKind, Paged, STATUS_LABEL, StudioApi, problemMessage } from './studio-api';

const STATUSES: (ArticleStatus | '')[] = ['', 'Draft', 'InReview', 'Scheduled', 'Published', 'Archived'];

/** The Studio's list of articles and pages, with filters. Authors see their own work; editors see everything. */
@Component({
  selector: 'app-studio-articles',
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h1>{{ isEditor() ? 'Articles and pages' : 'Your articles' }}</h1>
      <a class="btn" routerLink="/studio/articles/new">New article</a>
      @if (isEditor()) {
        <a class="btn btn--quiet" routerLink="/studio/articles/new" [queryParams]="{ kind: 'Page' }">New page</a>
      }
    </header>

    <form class="filters" (submit)="$event.preventDefault()">
      <label>
        Status
        <select [value]="status()" (change)="setStatus($any($event.target).value)">
          @for (s of statuses; track s) {
            <option [value]="s">{{ s ? label(s) : 'Any' }}</option>
          }
        </select>
      </label>
      @if (isEditor()) {
        <label>
          Type
          <select [value]="kind()" (change)="setKind($any($event.target).value)">
            <option value="">Articles and pages</option>
            <option value="Article">Articles</option>
            <option value="Page">Pages</option>
          </select>
        </label>
      }
      <label class="grow">
        Search titles
        <input type="search" [value]="text()" (input)="setText($any($event.target).value)" />
      </label>
    </form>

    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }

    @if (page(); as p) {
      @if (p.items.length) {
        <div class="scroll">
          <table>
            <caption class="visually-hidden">Articles and pages</caption>
            <thead>
              <tr><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Author</th><th scope="col">Updated</th></tr>
            </thead>
            <tbody>
              @for (row of p.items; track row.id) {
                <tr>
                  <th scope="row">
                    <a [routerLink]="['/studio/articles', row.id]">{{ row.title }}</a>
                    @if (row.kind === 'Page') {
                      <span class="tag">Page</span>
                    }
                  </th>
                  <td>
                    <span class="status" [attr.data-status]="row.status">{{ label(row.status) }}</span>
                    @if (row.status === 'Scheduled' && row.scheduledUtc) {
                      <span class="data"> {{ row.scheduledUtc | date: 'd MMM y, h:mm a' }}</span>
                    }
                  </td>
                  <td>{{ row.authorName }}</td>
                  <td class="data">{{ row.updatedUtc | date: 'd MMM y, h:mm a' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (pages() > 1) {
          <nav class="pager" aria-label="Pages of results">
            <button type="button" class="btn btn--quiet" [disabled]="p.page <= 1" (click)="go(p.page - 1)">Previous</button>
            <span class="data">Page {{ p.page }} of {{ pages() }} · {{ p.total }} items</span>
            <button type="button" class="btn btn--quiet" [disabled]="p.page >= pages()" (click)="go(p.page + 1)">Next</button>
          </nav>
        }
      } @else {
        <p>Nothing matches. <a routerLink="/studio/articles/new">Write something new.</a></p>
      }
    } @else if (!error()) {
      <p class="data" aria-live="polite">Loading…</p>
    }
  `,
  styles: `
    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }
    .head h1 {
      flex: 1;
      margin: 0;
      font-size: 1.8rem;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin: 1.25rem 0;
    }
    label {
      display: grid;
      gap: 0.2rem;
      font-size: 0.9rem;
    }
    .grow {
      flex: 1;
      min-width: 12rem;
    }
    select,
    input {
      padding: 0.4rem;
      font: inherit;
    }
    .error {
      color: var(--contact-red);
    }
    .scroll {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid var(--rule);
      text-align: left;
      vertical-align: top;
    }
    thead th {
      font-family: var(--font-display);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 0.85rem;
    }
    tbody th {
      font-weight: 600;
    }
    .tag {
      margin-left: 0.4rem;
      padding: 0 0.4rem;
      border: 1px solid var(--rule);
      font-size: 0.75rem;
    }
    .status {
      padding: 0.1rem 0.5rem;
      border-radius: 999px;
      background: var(--khaki);
      font-size: 0.85rem;
    }
    .status[data-status='Published'] {
      background: var(--olive-500);
      color: var(--paper);
    }
    .status[data-status='InReview'] {
      background: var(--brass);
    }
    .status[data-status='Archived'] {
      background: var(--rule);
    }
    .pager {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 1rem;
      margin-top: 1rem;
    }
  `,
})
export class StudioArticles {
  private readonly api = inject(StudioApi);
  private readonly auth = inject(AuthService);

  protected readonly statuses = STATUSES;
  protected readonly isEditor = computed(() => this.auth.hasRole('editor'));
  protected readonly status = signal<ArticleStatus | ''>('');
  protected readonly kind = signal<ContentKind | ''>('');
  protected readonly text = signal('');
  protected readonly page = signal<Paged<ArticleRow> | null>(null);
  protected readonly error = signal('');
  protected readonly pages = computed(() => {
    const p = this.page();
    return p ? Math.max(1, Math.ceil(p.total / p.pageSize)) : 1;
  });

  private timer?: ReturnType<typeof setTimeout>;
  private latest = 0;

  constructor() {
    void this.load(1);
  }

  protected label(s: ArticleStatus): string {
    return STATUS_LABEL[s];
  }

  protected setStatus(v: string): void {
    this.status.set(v as ArticleStatus | '');
    void this.load(1);
  }

  protected setKind(v: string): void {
    this.kind.set(v as ContentKind | '');
    void this.load(1);
  }

  protected setText(v: string): void {
    this.text.set(v);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(1), 300);
  }

  protected go(page: number): void {
    void this.load(page);
  }

  private async load(page: number): Promise<void> {
    const ticket = ++this.latest;                     // an answer to an older search is ignored
    try {
      const result = await this.api.list({ status: this.status(), kind: this.kind(), q: this.text(), page });
      if (ticket === this.latest) {
        this.page.set(result);
        this.error.set('');
      }
    } catch (e) {
      if (ticket === this.latest) {
        this.error.set(problemMessage(e, 'The list could not be loaded.'));
      }
    }
  }
}
