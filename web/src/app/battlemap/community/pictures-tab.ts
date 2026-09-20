import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { problemMessage } from '../../studio/studio-api';
import { CommunityService, IncidentMediaView } from './community';

/** Pictures members have added to one incident, with likes, and a form to add another. */
@Component({
  selector: 'app-incident-pictures',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './community.css',
  styles: `
    .grid {
      display: grid;
      gap: 0.6rem;
      grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
      list-style: none;
      margin: 0.5rem 0;
      padding: 0;
    }
    .pic img {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
    }
    .pic figcaption {
      font-size: 0.8rem;
      color: var(--khaki);
    }
    .pic {
      margin: 0;
    }
    .like[aria-pressed='true'] {
      background: var(--contact-red);
      border-color: var(--contact-red);
    }
  `,
  template: `
    @if (!auth.isAuthenticated()) {
      <p class="hint"><button type="button" class="link" (click)="auth.login()">Sign in</button> to add a picture or like one.</p>
    }
    @if (message()) {
      <p class="error" role="alert">{{ message() }}</p>
    }

    @if (pictures(); as list) {
      <ul class="grid">
        @for (m of list; track m.id) {
          <li>
            <figure class="pic">
              <a [href]="m.url" target="_blank" rel="noopener">
                <img [src]="m.thumbUrl" [alt]="m.caption || 'A picture of this incident'" loading="lazy" />
              </a>
              <figcaption>
                @if (m.caption) {
                  {{ m.caption }}<br />
                }
                @if (m.credit || m.dateTaken) {
                  <span class="meta">{{ m.credit }}{{ m.credit && m.dateTaken ? ', ' : '' }}{{ m.dateTaken ? (m.dateTaken | date: 'd MMM y') : '' }}</span><br />
                }
                @if (m.status !== 'Approved') {
                  <span class="badge" [class.badge--rejected]="m.status === 'Rejected'">{{ m.status === 'Pending' ? 'Waiting for approval' : 'Not accepted' }}</span>
                }
              </figcaption>
              <div class="actions">
                @if (auth.isAuthenticated() && m.status === 'Approved') {
                  <button type="button" class="like" [attr.aria-pressed]="m.likedByMe" [attr.aria-label]="(m.likedByMe ? 'Unlike' : 'Like') + ' this picture'" (click)="like(m)">♥ {{ m.likes }}</button>
                } @else if (m.likes) {
                  <span class="meta">♥ {{ m.likes }}</span>
                }
                @if (m.canRemove) {
                  <button type="button" class="danger" (click)="remove(m)" [disabled]="busy()">Remove</button>
                }
              </div>
            </figure>
          </li>
        } @empty {
          <li class="empty">No pictures have been added to this incident yet.</li>
        }
      </ul>
    } @else if (!message()) {
      <p class="hint" role="status">Loading…</p>
    }

    @if (auth.isAuthenticated()) {
      <h4>Add a picture</h4>
      <form (submit)="$event.preventDefault(); upload(file, caption, credit, taken)">
        <label>Picture (JPEG, PNG or WebP) <input #file type="file" accept="image/jpeg,image/png,image/webp" required /></label>
        <label>Caption <input #caption type="text" maxlength="500" /></label>
        <label>Credit <input #credit type="text" maxlength="200" /></label>
        <label>Date taken (optional) <input #taken type="date" /></label>
        <p class="hint">{{ isEditor() ? 'Pictures from editors appear at once.' : 'An editor looks at new pictures before they appear.' }}</p>
        <div class="actions"><button type="submit" class="primary" [disabled]="busy()">{{ busy() ? 'Uploading…' : 'Add picture' }}</button></div>
      </form>
    }
  `,
})
export class PicturesTab {
  readonly contactId = input.required<number>();
  readonly counted = output<number>();

  protected readonly auth = inject(AuthService);
  private readonly api = inject(CommunityService);

  protected readonly pictures = signal<IncidentMediaView[] | null>(null);
  protected readonly message = signal('');
  protected readonly busy = signal(false);

  private latest = 0;

  constructor() {
    effect(() => {
      const id = this.contactId();
      this.pictures.set(null);
      void this.load(id);
    });
  }

  protected isEditor(): boolean {
    return this.auth.hasRole('editor');
  }

  private async load(id: number): Promise<void> {
    const ticket = ++this.latest;
    try {
      const list = await this.api.media(id);
      if (ticket === this.latest) {
        this.pictures.set(list);
        this.message.set('');
        this.counted.emit(list.length);
      }
    } catch (e) {
      if (ticket === this.latest) {
        this.message.set(problemMessage(e, 'The pictures could not be loaded.'));
      }
    }
  }

  protected async upload(file: HTMLInputElement, caption: HTMLInputElement, credit: HTMLInputElement, taken: HTMLInputElement): Promise<void> {
    const chosen = file.files?.[0];
    if (!chosen) {
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      await this.api.addMedia(this.contactId(), chosen, caption.value, credit.value, taken.value);
      file.value = caption.value = credit.value = taken.value = '';
      await this.load(this.contactId());
    } catch (e) {
      this.message.set(problemMessage(e, 'The picture could not be added.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async like(m: IncidentMediaView): Promise<void> {
    try {
      const result = await this.api.toggleLike(m.id);
      this.pictures.update((list) => list?.map((x) => (x.id === m.id ? { ...x, likes: result.likes, likedByMe: result.liked } : x)) ?? null);
    } catch (e) {
      this.message.set(problemMessage(e));
    }
  }

  protected async remove(m: IncidentMediaView): Promise<void> {
    if (!confirm('Remove this picture from the incident?')) {
      return;
    }
    this.busy.set(true);
    try {
      await this.api.removeMedia(m.id);
      await this.load(this.contactId());
    } catch (e) {
      this.message.set(problemMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
