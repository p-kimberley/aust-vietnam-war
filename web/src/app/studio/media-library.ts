import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { MediaStatus, MediaView, Paged, StudioApi, problemMessage } from './studio-api';

/**
 * The picture library: browse, upload, describe and (for editors) approve pictures. Used as a page, and as a picker
 * when `picking` is set: choosing a picture then emits it instead of opening its details.
 */
@Component({
  selector: 'app-media-library',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="lib" aria-labelledby="lib-title">
      <header class="lib__head">
        <h2 id="lib-title">{{ picking() ? 'Choose a picture' : 'Pictures' }}</h2>
        <label class="lib__filter">
          Show
          <select [value]="status()" (change)="setStatus($any($event.target).value)">
            <option value="">All</option>
            <option value="Pending">Waiting for approval</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
        </label>
        <label class="lib__filter">
          Search
          <input type="search" [value]="text()" (input)="setText($any($event.target).value)" placeholder="Caption or credit" />
        </label>
      </header>

      <form class="lib__upload" (submit)="$event.preventDefault(); upload(file, caption, credit)">
        <label>Picture (JPEG, PNG or WebP)<input #file type="file" accept="image/jpeg,image/png,image/webp" required /></label>
        <label>Caption<input #caption type="text" maxlength="500" /></label>
        <label>Credit<input #credit type="text" maxlength="200" /></label>
        <button class="btn" type="submit" [disabled]="uploading()">{{ uploading() ? 'Uploading…' : 'Upload' }}</button>
      </form>
      @if (!isEditor()) {
        <p class="note">Pictures you upload are checked by an editor before they can be used as an article's main image.</p>
      }
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }

      @if (page(); as p) {
        @if (p.items.length) {
          <ul class="grid">
            @for (m of p.items; track m.id) {
              <li class="tile" [class.is-selected]="selected()?.id === m.id">
                <button type="button" class="tile__pick" (click)="choose(m)" [attr.aria-label]="(picking() ? 'Use ' : 'Details of ') + (m.caption || 'picture ' + m.id)">
                  <img [src]="m.thumbUrl" [alt]="m.caption ?? ''" loading="lazy" />
                </button>
                <span class="badge" [attr.data-status]="m.status">{{ label(m.status) }}</span>
              </li>
            }
          </ul>
          @if (pages() > 1) {
            <nav class="pager" aria-label="Pages of pictures">
              <button type="button" class="btn btn--quiet" [disabled]="p.page <= 1" (click)="go(p.page - 1)">Previous</button>
              <span class="data">Page {{ p.page }} of {{ pages() }}</span>
              <button type="button" class="btn btn--quiet" [disabled]="p.page >= pages()" (click)="go(p.page + 1)">Next</button>
            </nav>
          }
        } @else {
          <p>No pictures here yet.</p>
        }
      } @else if (!error()) {
        <p class="data" aria-live="polite">Loading…</p>
      }

      @if (selected(); as m) {
        <aside class="detail" aria-label="Picture details">
          <img [src]="m.url" [alt]="m.caption ?? ''" />
          <form (submit)="$event.preventDefault(); save(m, cap.value, cred.value)">
            <label>Caption<input #cap type="text" maxlength="500" [value]="m.caption ?? ''" /></label>
            <label>Credit<input #cred type="text" maxlength="200" [value]="m.credit ?? ''" /></label>
            <p class="data">{{ m.width }} × {{ m.height }} · uploaded by {{ m.uploadedByName }} on {{ m.createdUtc | date: 'd MMM y' }} · {{ label(m.status) }}</p>
            <div class="actions">
              <button class="btn" type="submit">Save details</button>
              @if (isEditor() && m.status !== 'Approved') {
                <button type="button" class="btn btn--quiet" (click)="setMediaStatus(m, 'Approved')">Approve</button>
              }
              @if (isEditor() && m.status !== 'Rejected') {
                <button type="button" class="btn btn--quiet" (click)="setMediaStatus(m, 'Rejected')">Reject</button>
              }
              <button type="button" class="btn btn--quiet" (click)="selected.set(null)">Close</button>
            </div>
          </form>
        </aside>
      }
    </section>
  `,
  styles: `
    .lib__head {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 1rem;
    }
    .lib__head h2 {
      flex: 1;
      margin: 0;
    }
    label {
      display: grid;
      gap: 0.2rem;
      font-size: 0.9rem;
    }
    input {
      padding: 0.4rem;
      font: inherit;
    }
    .lib__upload {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 0.75rem;
      margin: 1rem 0;
      padding: 0.75rem;
      background: var(--surface-raised);
      border: 1px solid var(--rule);
    }
    .lib__upload label:nth-child(2),
    .lib__upload label:nth-child(3) {
      flex: 1;
      min-width: 10rem;
    }
    .note,
    .error {
      margin: 0.5rem 0;
    }
    .error {
      color: var(--contact-red);
    }
    .grid {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
      list-style: none;
      margin: 1rem 0;
      padding: 0;
    }
    .tile {
      position: relative;
      border: 2px solid transparent;
    }
    .tile.is-selected {
      border-color: var(--focus);
    }
    .tile__pick {
      display: block;
      width: 100%;
      padding: 0;
      border: 1px solid var(--rule);
      background: #fff;
      cursor: pointer;
    }
    .tile img {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
    }
    .badge {
      position: absolute;
      left: 0.25rem;
      bottom: 0.25rem;
      padding: 0 0.4rem;
      font-size: 0.75rem;
      background: var(--olive-900);
      color: var(--paper);
    }
    .badge[data-status='Pending'] {
      background: var(--brass);
      color: var(--ink);
    }
    .badge[data-status='Rejected'] {
      background: var(--contact-red);
    }
    .pager {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 1rem;
    }
    .detail {
      display: grid;
      gap: 1rem;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      margin-top: 1rem;
      padding: 1rem;
      border: 1px solid var(--rule);
      background: var(--surface-raised);
    }
    .detail img {
      width: 100%;
      height: auto;
    }
    .detail form {
      display: grid;
      gap: 0.75rem;
      align-content: start;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    @media (max-width: 40rem) {
      .detail {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class MediaLibrary {
  readonly picking = input(false);
  /** Emitted when a picture is chosen while `picking`. */
  readonly picked = output<MediaView>();

  private readonly api = inject(StudioApi);
  private readonly auth = inject(AuthService);

  protected readonly isEditor = computed(() => this.auth.hasRole('editor'));
  protected readonly status = signal<MediaStatus | ''>('');
  protected readonly text = signal('');
  protected readonly page = signal<Paged<MediaView> | null>(null);
  protected readonly selected = signal<MediaView | null>(null);
  protected readonly uploading = signal(false);
  protected readonly error = signal('');
  protected readonly pages = computed(() => {
    const p = this.page();
    return p ? Math.max(1, Math.ceil(p.total / p.pageSize)) : 1;
  });

  private searchTimer?: ReturnType<typeof setTimeout>;
  private latest = 0;

  constructor() {
    void this.load(1);
  }

  protected label(status: MediaStatus): string {
    return status === 'Pending' ? 'Waiting' : status;
  }

  protected setStatus(value: string): void {
    this.status.set(value as MediaStatus | '');
    void this.load(1);
  }

  protected setText(value: string): void {
    this.text.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(1), 300);
  }

  protected go(page: number): void {
    void this.load(page);
  }

  private async load(page: number): Promise<void> {
    const ticket = ++this.latest;
    try {
      const result = await this.api.media({ status: this.status(), q: this.text(), page });
      if (ticket === this.latest) {
        this.page.set(result);
        this.error.set('');
      }
    } catch (e) {
      if (ticket === this.latest) {
        this.error.set(problemMessage(e, 'The pictures could not be loaded.'));
      }
    }
  }

  protected choose(m: MediaView): void {
    if (this.picking()) {
      this.picked.emit(m);
    } else {
      this.selected.set(m);
    }
  }

  protected async upload(input: HTMLInputElement, caption: HTMLInputElement, credit: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.uploading.set(true);
    this.error.set('');
    try {
      const made = await this.api.uploadMedia(file, caption.value, credit.value);
      input.value = caption.value = credit.value = '';
      await this.load(1);
      if (this.picking()) {
        this.picked.emit(made);
      }
    } catch (e) {
      this.error.set(problemMessage(e, 'The picture could not be uploaded.'));
    } finally {
      this.uploading.set(false);
    }
  }

  protected async save(m: MediaView, caption: string, credit: string): Promise<void> {
    await this.change(() => this.api.updateMedia(m.id, caption || null, credit || null), m);
  }

  protected async setMediaStatus(m: MediaView, status: MediaStatus): Promise<void> {
    await this.change(() => this.api.setMediaStatus(m.id, status), m);
  }

  private async change(call: () => Promise<MediaView>, old: MediaView): Promise<void> {
    try {
      const updated = await call();
      this.selected.set(updated);
      this.page.update((p) => (p ? { ...p, items: p.items.map((i) => (i.id === old.id ? updated : i)) } : p));
      this.error.set('');
    } catch (e) {
      this.error.set(problemMessage(e));
    }
  }
}
