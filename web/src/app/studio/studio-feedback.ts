import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { problemMessage } from './studio-api';

export interface FeedbackRow {
  id: number;
  name: string | null;
  email: string | null;
  message: string;
  createdUtc: string;
  handled: boolean;
}

/** The editors' inbox for the site's feedback form. */
@Component({
  selector: 'app-studio-feedback',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Feedback</h1>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (rows(); as list) {
      @if (list.length) {
        <ul class="list">
          @for (r of list; track r.id) {
            <li class="item" [class.is-done]="r.handled">
              <p class="meta data">
                {{ r.createdUtc | date: 'd MMM y, h:mm a' }} · {{ r.name || 'Anonymous' }}
                @if (r.email) {
                  · <a [href]="'mailto:' + r.email">{{ r.email }}</a>
                }
              </p>
              <p class="text">{{ r.message }}</p>
              <button type="button" class="btn btn--quiet" (click)="mark(r, !r.handled)">{{ r.handled ? 'Mark as not done' : 'Mark as done' }}</button>
            </li>
          }
        </ul>
      } @else {
        <p>No feedback yet.</p>
      }
    } @else if (!error()) {
      <p class="data" aria-live="polite">Loading…</p>
    }
  `,
  styles: `
    .list {
      display: grid;
      gap: 1rem;
      list-style: none;
      padding: 0;
    }
    .item {
      padding: 0.9rem 1.1rem;
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-left: 4px solid var(--brass);
    }
    .item.is-done {
      opacity: 0.6;
      border-left-color: var(--olive-500);
    }
    .meta {
      margin: 0 0 0.4rem;
      font-size: 0.9rem;
    }
    .text {
      margin: 0 0 0.6rem;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .error {
      color: var(--contact-red);
    }
  `,
})
export class StudioFeedback {
  private readonly http = inject(HttpClient);

  protected readonly rows = signal<FeedbackRow[] | null>(null);
  protected readonly error = signal('');

  constructor() {
    firstValueFrom(this.http.get<FeedbackRow[]>('/api/studio/feedback')).then(
      (list) => this.rows.set(list),
      (e) => this.error.set(problemMessage(e, 'The feedback could not be loaded.')),
    );
  }

  protected async mark(row: FeedbackRow, handled: boolean): Promise<void> {
    try {
      const updated = await firstValueFrom(this.http.post<FeedbackRow>(`/api/studio/feedback/${row.id}/handled`, { handled }));
      this.rows.update((list) => list?.map((r) => (r.id === row.id ? updated : r)) ?? null);
    } catch (e) {
      this.error.set(problemMessage(e));
    }
  }
}
