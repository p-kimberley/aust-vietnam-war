import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Icon } from '../battlemap/icon';
import { SiteNav } from '../content/content';
import { AuthService } from '../core/auth.service';

/** The width of the profile button (2.5rem), for working out whether it fits. */
const PROFILE_PX = 40;

@Component({
  selector: 'app-site-header',
  imports: [RouterLink, RouterLinkActive, NgTemplateOutlet, Icon],
  host: {
    '(document:click)': 'outside($event)',
    '(keydown.escape)': 'closeMenu(true)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Register and Sign in (or, signed in, Studio, the name and Sign out), wherever they are shown. -->
    <ng-template #accountItems>
      @if (auth.loaded()) {
        @if (auth.isAuthenticated()) {
          @if (auth.hasRole('author')) {
            <a class="link" routerLink="/studio" (click)="closeMenu(false)">Studio</a>
          }
          <span class="who data">{{ auth.user().name }}</span>
          <button type="button" class="btn btn--quiet" (click)="auth.logout()">Sign out</button>
        } @else {
          <button type="button" class="link" (click)="auth.register()">Register</button>
          <button type="button" class="btn" (click)="auth.login()">Sign in</button>
        }
      }
    </ng-template>

    <header class="bar">
      <div #inner class="wrap bar__inner" [class.is-stacked]="stacked()" [class.is-folded]="folded()">
        <a #brand class="brand" routerLink="/">
          <img class="brand__mark" src="/icon-small.svg" alt="" width="36" height="36" />
          <span class="brand__name">Australia's <b>Vietnam War</b></span>
        </a>

        <nav #navBar class="nav" aria-label="Main">
          <a routerLink="/" routerLinkActive="is-active" [routerLinkActiveOptions]="{ exact: true }">Home</a>
          <a routerLink="/battlemap" routerLinkActive="is-active">Battle Map</a>
          <a routerLink="/articles" routerLinkActive="is-active">Stories</a>
          @for (page of nav.pages.value(); track page.path) {
            <a [routerLink]="'/' + page.path" routerLinkActive="is-active">{{ page.title }}</a>
          }
        </nav>

        <!--
          In a row with the nav when they fit; otherwise behind a profile button at the end of the nav's row. The full set stays in
          the page (hidden, and out of the way of the keyboard and screen readers) so that whether it fits can be measured.
        -->
        <div #account class="account" [class.is-folded]="folded()" [attr.aria-hidden]="folded() || null" [attr.inert]="folded() || null">
          <ng-container [ngTemplateOutlet]="accountItems" />
        </div>
        @if (folded()) {
          <div class="profile">
            <button
              type="button"
              class="profile__button"
              [attr.aria-label]="auth.isAuthenticated() ? 'Account' : 'Register or sign in'"
              aria-controls="profile-menu"
              [attr.aria-expanded]="menuOpen()"
              (click)="menuOpen.set(!menuOpen())"
            >
              <app-icon name="user" />
            </button>
            @if (menuOpen()) {
              <div id="profile-menu" class="profile__menu">
                <ng-container [ngTemplateOutlet]="accountItems" />
              </div>
            }
          </div>
        }
      </div>
    </header>
  `,
  styles: `
    .bar {
      /* Below the status bar when the site runs as an installed app (viewport-fit=cover); nothing in a browser tab. */
      padding-top: env(safe-area-inset-top, 0px);
      padding-inline: env(safe-area-inset-left, 0px) env(safe-area-inset-right, 0px);
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
    /* The site icon, in its bolder small version: Vietnam, with a poppy over Phuoc Tuy (public/icon-small.svg). */
    .brand__mark {
      flex: none;
      width: 2.25rem;
      height: 2.25rem;
    }
    .nav {
      display: flex;
      gap: 1.25rem;
      flex: 1;
    }
    .nav a,
    .link {
      /* A link never breaks across lines: a crowded nav moves to a row of its own instead. */
      white-space: nowrap;
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
    /* Kept for measuring, out of sight and out of the flow. */
    .account.is-folded {
      position: absolute;
      visibility: hidden;
      pointer-events: none;
    }
    .bar__inner {
      position: relative;
    }
    .profile {
      position: relative;
      margin-left: auto;
    }
    /*
     * When the nav needs a row of its own under the name: with Register and Sign in after it, or, folded, with the profile button
     * at the end of the name's row, where there is room.
     */
    .is-stacked .brand {
      flex-basis: 100%;
    }
    .is-stacked.is-folded .brand {
      flex-basis: auto;
      order: 0;
    }
    .is-stacked.is-folded .profile {
      order: 1;
    }
    .is-stacked.is-folded .nav {
      flex-basis: 100%;
      order: 2;
    }
    .profile__button {
      display: inline-grid;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      padding: 0;
      color: var(--khaki);
      background: none;
      border: 1px solid var(--olive-500);
      border-radius: 50%;
      cursor: pointer;
    }
    .profile__button:hover,
    .profile__button[aria-expanded='true'] {
      color: var(--smoke-yellow);
      border-color: var(--smoke-yellow);
    }
    .profile__button:focus-visible {
      outline: 2px solid var(--smoke-yellow);
      outline-offset: 2px;
    }
    .profile__button app-icon {
      margin: 0;
    }
    .profile__menu {
      position: absolute;
      z-index: 20;
      top: calc(100% + 0.5rem);
      right: 0;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.6rem;
      min-width: 11rem;
      padding: 0.75rem;
      background: var(--olive-900);
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
      box-shadow: 0 6px 20px rgb(0 0 0 / 0.5);
    }
    .profile__menu .link {
      text-align: left;
    }
    /* On a phone the name, and the gaps, are a little smaller, so the profile button fits on the name's row. */
    @media (max-width: 45rem) {
      .bar__inner {
        column-gap: 0.75rem;
      }
      .brand {
        font-size: 1.05rem;
      }
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
  protected readonly nav = inject(SiteNav);

  /** Register and Sign in do not fit on the nav's row, so they are behind the profile button. */
  protected readonly folded = signal(false);
  protected readonly menuOpen = signal(false);
  /** The nav is on a row of its own, under the name. */
  protected readonly stacked = signal(false);
  private readonly brand = viewChild.required<ElementRef<HTMLElement>>('brand');
  private readonly inner = viewChild.required<ElementRef<HTMLElement>>('inner');
  private readonly navEl = viewChild.required<ElementRef<HTMLElement>>('navBar');
  private readonly account = viewChild.required<ElementRef<HTMLElement>>('account');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const destroyRef = inject(DestroyRef);
    // In the browser only (the server cannot measure): look again whenever the header, the nav or the account items change size.
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver(() => this.measure());
      for (const el of [this.inner(), this.navEl(), this.account()]) {
        observer.observe(el.nativeElement);
      }
      destroyRef.onDestroy(() => observer.disconnect());
      this.measure();
    });
  }

  /**
   * How the header's pieces are laid out, from their own widths (not from where they happen to be, which this changes). Widest
   * first: the name, the nav and the account items on one row; the name and the nav, with the profile button; the nav on a row of
   * its own with the account items after it; or, narrowest, the name with the profile button, and the nav on a row of its own.
   * The account items are measured even while folded away.
   */
  private measure(): void {
    const row = this.inner().nativeElement.getBoundingClientRect().width;
    const links = [...this.navEl().nativeElement.children].map((a) => a.getBoundingClientRect());
    if (!links.length || row === 0) {
      return;
    }
    const gap = parseFloat(getComputedStyle(this.inner().nativeElement).columnGap) || 0;
    const brand = this.brand().nativeElement.getBoundingClientRect().width;
    const nav = Math.max(...links.map((r) => r.right)) - Math.min(...links.map((r) => r.left));
    const account = this.account().nativeElement.getBoundingClientRect().width;
    const fit = (...widths: number[]) => widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1) <= row + 0.5;

    let folded: boolean;
    let stacked: boolean;
    if (fit(brand, nav, account)) {
      [folded, stacked] = [false, false];
    } else if (fit(brand, nav, PROFILE_PX)) {
      [folded, stacked] = [true, false];
    } else if (fit(nav, account)) {
      [folded, stacked] = [false, true];
    } else {
      [folded, stacked] = [true, true];
    }
    this.stacked.set(stacked);
    this.folded.set(folded);
    if (!folded) this.menuOpen.set(false);
  }

  /** Puts the menu away; `refocus` puts the keyboard back on its button (after Escape). */
  protected closeMenu(refocus: boolean): void {
    if (!this.menuOpen()) {
      return;
    }
    this.menuOpen.set(false);
    if (refocus) {
      this.host.nativeElement.querySelector<HTMLButtonElement>('.profile__button')?.focus();
    }
  }

  protected outside(event: Event): void {
    const profile = this.host.nativeElement.querySelector('.profile');
    if (profile && !profile.contains(event.target as Node)) {
      this.closeMenu(false);
    }
  }
}
