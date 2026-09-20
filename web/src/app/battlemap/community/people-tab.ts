import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { problemMessage } from '../../studio/studio-api';
import { CASUALTY_TYPES, CommunityService, HonourSummary } from './community';

/** The people on the honour roll who became casualties in this incident, and a form to tell us about one. */
@Component({
  selector: 'app-incident-people',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './community.css',
  template: `
    @if (message()) {
      <p class="error" role="alert">{{ message() }}</p>
    }

    @if (people(); as list) {
      @if (list.length) {
        <ul class="people">
          @for (p of list; track p.serviceNumber) {
            <li>
              <button type="button" class="link" (click)="open.emit(p.serviceNumber)">{{ p.name }}</button>
              <span class="meta">{{ [p.rank, p.branch].filter(present).join(', ') }}</span>
            </li>
          }
        </ul>
      } @else {
        <p class="empty">No one on the honour roll is linked to this incident.</p>
      }
    } @else if (!message()) {
      <p class="hint" role="status">Loading…</p>
    }

    <h4>Tell us about a casualty</h4>
    @if (sent()) {
      <p class="ok" role="status">Thank you. An editor will look at what you have sent.</p>
    } @else if (!auth.isAuthenticated()) {
      <p class="hint"><button type="button" class="link" (click)="auth.login()">Sign in</button> to tell us about someone killed or wounded in this incident.</p>
    } @else {
      <form (submit)="$event.preventDefault(); send(number.value, type.value, comment.value)">
        <label>Service number (if you know it) <input #number type="text" maxlength="32" /></label>
        <label>
          What happened to them
          <select #type required>
            <option value="" disabled selected>Choose…</option>
            @for (t of types; track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
        </label>
        <label>What you know, and where you know it from <textarea #comment rows="4" maxlength="2000" required></textarea></label>
        <div class="actions"><button type="submit" class="primary" [disabled]="busy()">Send</button></div>
      </form>
    }
  `,
  styles: `
    .people {
      margin: 0.4rem 0;
      padding-left: 1.1rem;
    }
    .people li {
      margin: 0.25rem 0;
    }
  `,
})
export class PeopleTab {
  readonly contactId = input.required<number>();
  readonly counted = output<number>();
  /** Opens a person's page, by service number. */
  readonly open = output<string>();

  protected readonly auth = inject(AuthService);
  private readonly api = inject(CommunityService);

  protected readonly types = CASUALTY_TYPES;
  protected readonly people = signal<HonourSummary[] | null>(null);
  protected readonly message = signal('');
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly present = (s: string | null): s is string => !!s;

  private latest = 0;

  constructor() {
    effect(() => {
      const id = this.contactId();
      this.people.set(null);
      this.sent.set(false);
      void this.load(id);
    });
  }

  private async load(id: number): Promise<void> {
    const ticket = ++this.latest;
    try {
      const list = await this.api.casualties(id);
      if (ticket === this.latest) {
        this.people.set(list);
        this.message.set('');
        this.counted.emit(list.length);
      }
    } catch (e) {
      if (ticket === this.latest) {
        this.message.set(problemMessage(e, 'The honour roll could not be loaded.'));
      }
    }
  }

  protected async send(serviceNumber: string, casualtyType: string, comment: string): Promise<void> {
    this.busy.set(true);
    this.message.set('');
    try {
      await this.api.submitCasualty(this.contactId(), { serviceNumber: serviceNumber.trim() || null, casualtyType, comment });
      this.sent.set(true);
    } catch (e) {
      this.message.set(problemMessage(e, 'That could not be sent.'));
    } finally {
      this.busy.set(false);
    }
  }
}
