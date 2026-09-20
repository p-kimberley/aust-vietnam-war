import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Seo } from '../core/seo.service';

type State = 'editing' | 'sending' | 'sent';

/** The feedback form. The hidden "website" box is a decoy for bots; a person never fills it in. */
@Component({
  selector: 'app-feedback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap page">
      <h1>Send feedback</h1>
      @if (state() === 'sent') {
        <p class="thanks" role="status">Thank you. Your message has been sent to the editors.</p>
      } @else {
        <p class="lead">Found a mistake, or have something to add? Tell us. Please do not send personal or medical details.</p>
        <form (submit)="$event.preventDefault(); send(name.value, email.value, message.value, website.value)" novalidate>
          <label>
            Your name <span class="opt">(optional)</span>
            <input #name type="text" maxlength="100" autocomplete="name" />
          </label>
          <label>
            Your email <span class="opt">(optional, only if you would like a reply)</span>
            <input #email type="email" maxlength="200" autocomplete="email" [attr.aria-invalid]="errors()['email'] ? 'true' : null" [attr.aria-describedby]="errors()['email'] ? 'email-error' : null" />
            @if (errors()['email']; as e) {
              <span class="error" id="email-error">{{ e }}</span>
            }
          </label>
          <label>
            Message
            <textarea #message rows="8" maxlength="2000" required [attr.aria-invalid]="errors()['message'] ? 'true' : null" [attr.aria-describedby]="errors()['message'] ? 'message-error' : null"></textarea>
            @if (errors()['message']; as e) {
              <span class="error" id="message-error">{{ e }}</span>
            }
          </label>
          <div class="decoy" aria-hidden="true">
            <label>Website <input #website type="text" tabindex="-1" autocomplete="off" /></label>
          </div>
          @if (problem()) {
            <p class="error" role="alert">{{ problem() }}</p>
          }
          <button class="btn" type="submit" [disabled]="state() === 'sending'">{{ state() === 'sending' ? 'Sending…' : 'Send' }}</button>
        </form>
      }
    </div>
  `,
  styles: `
    .page {
      padding-block: 2.5rem;
      max-width: 40rem;
    }
    form {
      display: grid;
      gap: 1rem;
    }
    label {
      display: grid;
      gap: 0.25rem;
    }
    .opt {
      color: var(--text-muted);
      font-size: 0.9rem;
    }
    input,
    textarea {
      padding: 0.5rem;
      font: inherit;
      border: 1px solid var(--rule);
      background: #fff;
    }
    .error {
      color: var(--contact-red);
    }
    .thanks {
      padding: 1rem;
      background: var(--surface-raised);
      border-left: 4px solid var(--olive-500);
    }
    .decoy {
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    }
    button {
      justify-self: start;
    }
  `,
})
export class Feedback {
  private readonly http = inject(HttpClient);

  protected readonly state = signal<State>('editing');
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly problem = signal('');

  constructor() {
    inject(Seo).set({ title: 'Send feedback', description: 'Tell the editors about a mistake, or add something we have missed.', path: '/feedback' });
  }

  protected async send(name: string, email: string, message: string, website: string): Promise<void> {
    this.errors.set({});
    this.problem.set('');
    this.state.set('sending');
    try {
      await firstValueFrom(this.http.post('/api/feedback', { name, email, message, website }));
      this.state.set('sent');
    } catch (e) {
      this.state.set('editing');
      if (e instanceof HttpErrorResponse && e.status === 400 && e.error?.errors) {
        this.errors.set(Object.fromEntries(Object.entries(e.error.errors as Record<string, string[]>).map(([k, v]) => [k, v[0]])));
      } else if (e instanceof HttpErrorResponse && e.status === 429) {
        this.problem.set('You have sent several messages already. Please try again in a few minutes.');
      } else {
        this.problem.set('Your message could not be sent. Please try again shortly.');
      }
    }
  }
}
