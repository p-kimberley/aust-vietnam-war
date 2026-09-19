import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-site-header',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="bar">
      <div class="wrap bar__inner">
        <a class="brand" routerLink="/">
          <span class="brand__mark" aria-hidden="true"></span>
          <span class="brand__name">Australia's <b>Vietnam War</b></span>
        </a>

        <nav class="nav" aria-label="Main">
          <a routerLink="/" routerLinkActive="is-active" [routerLinkActiveOptions]="{ exact: true }">Home</a>
          <a routerLink="/battlemap" routerLinkActive="is-active">Battle Map</a>
          <a routerLink="/about" routerLinkActive="is-active">About</a>
        </nav>

        <div class="account">
          @if (auth.loaded()) {
            @if (auth.isAuthenticated()) {
              @if (auth.hasRole('author')) {
                <a class="link" routerLink="/studio">Studio</a>
              }
              <span class="who data">{{ auth.user().name }}</span>
              <button type="button" class="btn btn--quiet" (click)="auth.logout()">Sign out</button>
            } @else {
              <button type="button" class="link" (click)="auth.register()">Register</button>
              <button type="button" class="btn" (click)="auth.login()">Sign in</button>
            }
          }
        </div>
      </div>
    </header>
  `,
  styles: `
    .bar {
      background: var(--olive-900);
      color: var(--paper);
      border-bottom: 4px solid var(--brass);
    }
    .bar__inner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem 2rem;
      padding-block: 0.75rem;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      color: inherit;
      text-decoration: none;
      font-family: var(--font-display);
      font-size: 1.25rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .brand b {
      color: var(--smoke-yellow);
    }
    .brand__mark {
      width: 1.1rem;
      height: 1.1rem;
      border-radius: 50%;
      background: var(--contact-red);
      box-shadow: 0 0 0 3px var(--olive-700);
    }
    .nav {
      display: flex;
      gap: 1.25rem;
      flex: 1;
    }
    .nav a,
    .link {
      color: var(--khaki);
      text-decoration: none;
      font-family: var(--font-display);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      background: none;
      border: 0;
      padding: 0.25rem 0;
      cursor: pointer;
      font-size: 1rem;
    }
    .nav a:hover,
    .link:hover,
    .nav a.is-active {
      color: var(--smoke-yellow);
    }
    .nav a.is-active {
      border-bottom: 2px solid var(--smoke-yellow);
    }
    .account {
      display: flex;
      align-items: center;
      gap: 1rem;
      min-height: 2.5rem;
    }
    .who {
      color: var(--khaki);
      font-size: 0.9rem;
    }
    .account .btn--quiet {
      color: var(--khaki);
    }
  `,
})
export class SiteHeader {
  protected readonly auth = inject(AuthService);
}
