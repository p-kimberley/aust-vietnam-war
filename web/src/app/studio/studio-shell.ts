import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';

/** Client-only authoring area for author, editor and admin roles. The editor, media library and moderation land in phase 3. */
@Component({
  selector: 'app-studio-shell',
  imports: [RouterLink, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <strong class="title">Studio</strong>
      <span class="grow"></span>
      <a routerLink="/">View site</a>
      <span class="data">{{ auth.user().name }}</span>
      <button type="button" class="btn btn--quiet" (click)="auth.logout()">Sign out</button>
    </header>
    <main class="wrap body"><router-outlet /></main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
    }
    .top {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem var(--gutter);
      background: var(--olive-900);
      color: var(--paper);
      border-bottom: 4px solid var(--brass);
    }
    .title {
      font-family: var(--font-display);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--smoke-yellow);
    }
    .grow {
      flex: 1;
    }
    .top a {
      color: var(--khaki);
    }
    .top .btn--quiet {
      color: var(--khaki);
    }
    .body {
      padding-block: 2rem;
    }
  `,
})
export class StudioShell {
  protected readonly auth = inject(AuthService);
}
