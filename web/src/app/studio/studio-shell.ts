import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';

/** Client-only authoring area for author, editor and admin roles: articles and pages, and the picture library. */
@Component({
  selector: 'app-studio-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="top">
      <strong class="title">Studio</strong>
      <nav class="tabs" aria-label="Studio">
        <a routerLink="/studio/articles" routerLinkActive="is-active">{{ auth.hasRole('editor') ? 'Articles and pages' : 'Your articles' }}</a>
        <a routerLink="/studio/media" routerLinkActive="is-active">Pictures</a>
        @if (auth.hasRole('editor')) {
          <a routerLink="/studio/feedback" routerLinkActive="is-active">Feedback</a>
        }
      </nav>
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
    .tabs {
      display: flex;
      gap: 1rem;
    }
    .tabs a {
      padding-bottom: 0.15rem;
      text-decoration: none;
      border-bottom: 2px solid transparent;
    }
    .tabs a.is-active {
      color: var(--smoke-yellow);
      border-bottom-color: var(--smoke-yellow);
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
