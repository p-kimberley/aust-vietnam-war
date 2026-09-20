import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { problemMessage } from '../../studio/studio-api';
import { CommunityService, NoteView, VersionView } from './community';

/** Community notes about one incident: read them, add one, edit your own, comment, and (for editors) approve or reject. */
@Component({
  selector: 'app-incident-notes',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './community.css',
  template: `
    @if (!auth.isAuthenticated()) {
      <p class="hint">
        <button type="button" class="link" (click)="auth.login()">Sign in</button> to add a note or comment on this incident.
      </p>
    }
    @if (message()) {
      <p class="error" role="alert">{{ message() }}</p>
    }

    @if (notes(); as list) {
      @for (n of list; track n.id) {
        <article class="card" [class.card--pending]="n.status !== 'Approved'">
          <h4>
            {{ n.title }}
            @if (n.status === 'Pending') {
              <span class="badge">{{ n.pendingEdit ? 'Change waiting' : 'Waiting for approval' }}</span>
            } @else if (n.status === 'Rejected') {
              <span class="badge badge--rejected">{{ n.pendingEdit ? 'Change not accepted' : 'Not accepted' }}</span>
            }
          </h4>
          <p class="meta">By {{ n.authorName }}, {{ n.createdUtc | date: 'd MMM y' }}</p>

          @if (editing() === n.id) {
            <form (submit)="$event.preventDefault(); save(n, title.value, body.value)">
              <label>Title <input #title type="text" maxlength="200" required [value]="n.title" /></label>
              <label>Note <textarea #body rows="6" maxlength="5000" required [value]="n.body"></textarea></label>
              <div class="actions">
                <button type="submit" class="primary" [disabled]="busy()">Save</button>
                <button type="button" (click)="editing.set(null)">Cancel</button>
              </div>
            </form>
          } @else {
            <p class="body">{{ n.body }}</p>
          }

          @if (n.canEdit && editing() !== n.id) {
            <div class="actions">
              <button type="button" (click)="editing.set(n.id)">Edit</button>
              <button type="button" (click)="toggleHistory(n)">{{ history()[n.id] ? 'Hide history' : 'History' }}</button>
              <button type="button" class="danger" (click)="remove(n)" [disabled]="busy()">Delete</button>
            </div>
          }
          @if (isEditor() && n.status !== 'Approved') {
            <div class="actions">
              <button type="button" class="primary" (click)="moderate(n, 'Approved')" [disabled]="busy()">Approve</button>
              @if (n.status !== 'Rejected') {
                <button type="button" (click)="moderate(n, 'Rejected')" [disabled]="busy()">Reject</button>
              }
            </div>
          }
          @if (history()[n.id]; as versions) {
            <ol class="history" reversed>
              @for (v of versions; track v.versionNo) {
                <li>
                  Version {{ v.versionNo }} by {{ v.editedByName }}, {{ v.createdUtc | date: 'd MMM y, h:mm a' }}{{ v.approved ? ' (approved)' : '' }}
                  <div class="body">{{ v.body }}</div>
                </li>
              }
            </ol>
          }

          <ul class="comments" [attr.aria-label]="'Comments on ' + n.title">
            @for (c of n.comments; track c.id) {
              <li>
                <span class="meta">{{ c.authorName }}, {{ c.createdUtc | date: 'd MMM y' }}</span>
                <div class="body">{{ c.body }}</div>
                @if (c.canDelete) {
                  <button type="button" class="link" (click)="removeComment(c.id)" [disabled]="busy()">Delete comment</button>
                }
              </li>
            }
          </ul>
          @if (auth.isAuthenticated() && (n.commentsOpen || isEditor())) {
            <form (submit)="$event.preventDefault(); comment(n, remark)">
              <label>Add a comment <textarea #remark rows="2" maxlength="1000" required></textarea></label>
              <div class="actions"><button type="submit" [disabled]="busy()">Comment</button></div>
            </form>
          } @else if (!n.commentsOpen) {
            <p class="hint">Comments are closed on this note.</p>
          }
          @if (isEditor()) {
            <button type="button" class="link" (click)="setCommentsOpen(n, !n.commentsOpen)">{{ n.commentsOpen ? 'Close comments' : 'Open comments' }}</button>
          }
        </article>
      } @empty {
        <p class="empty">No notes have been added to this incident yet.</p>
      }
    } @else if (!message()) {
      <p class="hint" role="status">Loading…</p>
    }

    @if (auth.isAuthenticated()) {
      <h4>Add a note</h4>
      <form (submit)="$event.preventDefault(); add(newTitle, newBody)">
        <label>Title <input #newTitle type="text" maxlength="200" required /></label>
        <label>Note <textarea #newBody rows="5" maxlength="5000" required></textarea></label>
        <p class="hint">{{ isEditor() ? 'Notes from editors appear at once.' : 'An editor reads new notes before they appear.' }}</p>
        <div class="actions"><button type="submit" class="primary" [disabled]="busy()">Add note</button></div>
      </form>
    }
  `,
})
export class NotesTab {
  readonly contactId = input.required<number>();
  /** How many notes the viewer can see, for the tab's badge. */
  readonly counted = output<number>();

  protected readonly auth = inject(AuthService);
  private readonly api = inject(CommunityService);

  protected readonly notes = signal<NoteView[] | null>(null);
  protected readonly message = signal('');
  protected readonly busy = signal(false);
  protected readonly editing = signal<number | null>(null);
  protected readonly history = signal<Record<number, VersionView[]>>({});

  private latest = 0;

  constructor() {
    effect(() => {
      const id = this.contactId();
      void this.load(id, false);
    });
  }

  protected isEditor(): boolean {
    return this.auth.hasRole('editor');
  }

  /** `keep` refreshes in place (after a change of the reader's own), instead of starting again for another incident. */
  private async load(id: number, keep: boolean): Promise<void> {
    const ticket = ++this.latest;
    if (!keep) {
      this.notes.set(null);
      this.editing.set(null);
      this.history.set({});
    }
    try {
      const list = await this.api.notes(id);
      if (ticket === this.latest) {
        this.notes.set(list);
        this.message.set('');
        this.counted.emit(list.length);
      }
    } catch (e) {
      if (ticket === this.latest) {
        this.message.set(problemMessage(e, 'The notes could not be loaded.'));
      }
    }
  }

  private reload(): Promise<void> {
    return this.load(this.contactId(), true);
  }

  /** Runs a change, then reloads so what is shown is what the server holds. */
  private async change(work: () => Promise<unknown>): Promise<boolean> {
    this.busy.set(true);
    this.message.set('');
    try {
      await work();
      await this.reload();
      return true;
    } catch (e) {
      this.message.set(problemMessage(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async add(title: HTMLInputElement, body: HTMLTextAreaElement): Promise<void> {
    if (await this.change(() => this.api.createNote(this.contactId(), { title: title.value, body: body.value }))) {
      title.value = body.value = '';
    }
  }

  protected async save(n: NoteView, title: string, body: string): Promise<void> {
    if (await this.change(() => this.api.updateNote(n.id, { title, body }))) {
      this.editing.set(null);
    }
  }

  protected async remove(n: NoteView): Promise<void> {
    if (confirm(`Delete “${n.title}” and its comments? This cannot be undone.`)) {
      await this.change(() => this.api.deleteNote(n.id));
    }
  }

  protected moderate(n: NoteView, status: 'Approved' | 'Rejected'): Promise<boolean> {
    return this.change(() => this.api.moderateNote(n.id, status));
  }

  protected setCommentsOpen(n: NoteView, open: boolean): Promise<boolean> {
    return this.change(() => this.api.setCommentsOpen(n.id, open));
  }

  protected async comment(n: NoteView, box: HTMLTextAreaElement): Promise<void> {
    if (await this.change(() => this.api.addComment(n.id, box.value))) {
      box.value = '';
    }
  }

  protected removeComment(id: number): Promise<boolean> {
    return this.change(() => this.api.deleteComment(id));
  }

  protected async toggleHistory(n: NoteView): Promise<void> {
    if (this.history()[n.id]) {
      this.history.update(({ [n.id]: _gone, ...rest }) => rest);
      return;
    }
    try {
      const versions = await this.api.noteVersions(n.id);
      this.history.update((h) => ({ ...h, [n.id]: versions }));
    } catch (e) {
      this.message.set(problemMessage(e));
    }
  }
}
