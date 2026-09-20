import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommunityService, ModerationQueue, PendingNote, PendingPicture, CasualtyRow } from '../battlemap/community/community';
import { problemMessage } from './studio-api';

/** What community members have sent that needs an editor: notes and pictures waiting for approval, and casualty information to act on. */
@Component({
  selector: 'app-studio-moderation',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Moderation</h1>
    @if (message()) {
      <p class="error" role="alert">{{ message() }}</p>
    }

    @if (queue(); as q) {
      @if (!q.notes.length && !q.pictures.length && !q.casualties.length) {
        <p>Nothing is waiting. New notes, pictures and casualty information appear here.</p>
      }

      @if (q.notes.length) {
        <h2>Notes ({{ q.notes.length }})</h2>
        @for (n of q.notes; track n.id) {
          <article class="card">
            <h3>{{ n.title }} @if (n.isChange) { <span class="tag">A change to an approved note</span> }</h3>
            <p class="meta data">By {{ n.authorName }}, {{ n.updatedUtc | date: 'd MMM y, h:mm a' }} · <a [href]="'/battlemap?incident=' + n.contactId" target="_blank" rel="noopener">Incident {{ n.contactId }}</a></p>
            <p class="text">{{ n.body }}</p>
            <div class="actions">
              <button type="button" class="btn" (click)="noteAction(n, 'Approved')" [disabled]="busy()">Approve</button>
              <button type="button" class="btn btn--quiet" (click)="noteAction(n, 'Rejected')" [disabled]="busy()">Reject</button>
            </div>
          </article>
        }
      }

      @if (q.pictures.length) {
        <h2>Pictures ({{ q.pictures.length }})</h2>
        <div class="pics">
          @for (p of q.pictures; track p.incidentMediaId) {
            <article class="card">
              <a [href]="p.url" target="_blank" rel="noopener"><img [src]="p.thumbUrl" [alt]="p.caption || 'Picture waiting for approval'" loading="lazy" /></a>
              <p class="text">{{ p.caption }}</p>
              <p class="meta data">{{ p.credit }} · added by {{ p.uploadedByName }} @if (p.contactId !== null) {
                · <a [href]="'/battlemap?incident=' + p.contactId" target="_blank" rel="noopener">Incident {{ p.contactId }}</a>
              }</p>
              <div class="actions">
                <button type="button" class="btn" (click)="pictureAction(p, 'Approved')" [disabled]="busy()">Approve</button>
                <button type="button" class="btn btn--quiet" (click)="pictureAction(p, 'Rejected')" [disabled]="busy()">Reject</button>
              </div>
            </article>
          }
        </div>
      }

      @if (q.casualties.length) {
        <h2>Casualty information ({{ q.casualties.length }})</h2>
        @for (c of q.casualties; track c.id) {
          <article class="card">
            <h3>{{ c.casualtyType }}{{ c.serviceNumber ? ', service number ' + c.serviceNumber : '' }}</h3>
            <p class="meta data">From {{ c.submittedByName }}, {{ c.createdUtc | date: 'd MMM y, h:mm a' }} · <a [href]="'/battlemap?incident=' + c.contactId" target="_blank" rel="noopener">Incident {{ c.contactId }}</a></p>
            <p class="text">{{ c.comment }}</p>
            <div class="actions"><button type="button" class="btn btn--quiet" (click)="handled(c)" [disabled]="busy()">Mark as dealt with</button></div>
          </article>
        }
      }
    } @else if (!message()) {
      <p class="data" aria-live="polite">Loading…</p>
    }
  `,
  styles: `
    h2 {
      margin-top: 2rem;
      font-size: 1.3rem;
    }
    h3 {
      margin: 0 0 0.25rem;
      font-size: 1.05rem;
      text-transform: none;
    }
    .card {
      margin: 0.75rem 0;
      padding: 0.8rem 1rem;
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-left: 4px solid var(--brass);
    }
    .meta {
      margin: 0 0 0.4rem;
      font-size: 0.9rem;
      color: var(--text-muted);
    }
    .text {
      margin: 0 0 0.6rem;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .tag {
      margin-left: 0.4rem;
      padding: 0 0.4rem;
      border: 1px solid var(--rule);
      font-size: 0.75rem;
      font-weight: 400;
    }
    .actions {
      display: flex;
      gap: 0.5rem;
    }
    .pics {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    }
    .pics img {
      width: 100%;
      height: auto;
    }
    .error {
      color: var(--contact-red);
    }
  `,
})
export class StudioModeration {
  private readonly api = inject(CommunityService);

  protected readonly queue = signal<ModerationQueue | null>(null);
  protected readonly message = signal('');
  protected readonly busy = signal(false);

  constructor() {
    this.api.queue().then(
      (q) => this.queue.set(q),
      (e) => this.message.set(problemMessage(e, 'The queue could not be loaded.')),
    );
  }

  /** Runs an action, and takes the item off the list once the server has accepted it. */
  private async act(work: () => Promise<unknown>, remove: (q: ModerationQueue) => ModerationQueue): Promise<void> {
    this.busy.set(true);
    this.message.set('');
    try {
      await work();
      this.queue.update((q) => (q ? remove(q) : q));
    } catch (e) {
      this.message.set(problemMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected noteAction(n: PendingNote, status: 'Approved' | 'Rejected'): Promise<void> {
    return this.act(() => this.api.moderateNote(n.id, status), (q) => ({ ...q, notes: q.notes.filter((x) => x.id !== n.id) }));
  }

  protected pictureAction(p: PendingPicture, status: 'Approved' | 'Rejected'): Promise<void> {
    return this.act(() => this.api.setPictureStatus(p.mediaId, status), (q) => ({ ...q, pictures: q.pictures.filter((x) => x.incidentMediaId !== p.incidentMediaId) }));
  }

  protected handled(c: CasualtyRow): Promise<void> {
    return this.act(() => this.api.markCasualty(c.id, true), (q) => ({ ...q, casualties: q.casualties.filter((x) => x.id !== c.id) }));
  }
}
