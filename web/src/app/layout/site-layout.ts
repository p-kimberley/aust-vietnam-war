import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

/** Chrome for the public site. The Battle Map and Studio bring their own layouts. */
@Component({
  selector: 'app-site-layout',
  imports: [RouterOutlet, SiteHeader, SiteFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip visually-hidden" href="#main">Skip to content</a>
    <app-site-header />
    <main id="main" tabindex="-1"><router-outlet /></main>
    <app-site-footer />
  `,
  styles: `
    :host {
      display: block;
    }
    .skip:focus {
      position: fixed;
      z-index: 10;
      top: 0.5rem;
      left: 0.5rem;
      width: auto;
      height: auto;
      clip-path: none;
      padding: 0.5rem 1rem;
      background: var(--paper);
      color: var(--ink);
    }
    main {
      min-height: 60vh;
    }
    main:focus {
      outline: none;
    }
  `,
})
export class SiteLayout {}
