import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { Icon } from '../battlemap/icon';
import { narrowScreen, storedFlag } from '../battlemap/stored-flag';

/** Chrome's install prompt, which it offers once the site can be installed (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

/** How long a phone visitor has been on the site before the hint appears, so it does not greet them at the door. */
export const INSTALL_HINT_DELAY_MS = 4000;

/**
 * A one-time hint, on a phone, that the site can be added to the Home Screen, where it opens full screen: no address bar and no
 * toolbar, which the Battle Map most needs. On an iPhone or iPad it says how (Safari's Share, then Add to Home Screen; a site
 * cannot ask to be installed there). On Android, once Chrome offers it, an Install button brings up Chrome's own prompt. Not
 * shown once the site is running installed, or on a wider screen, or ever again once put away.
 */
@Component({
  selector: 'app-install-hint',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (kind(); as k) {
      <aside class="hint" aria-labelledby="install-hint-title">
        <p class="hint__title" id="install-hint-title">See the map full screen</p>
        @if (k === 'ios') {
          <p class="hint__text">
            Add this site to your Home Screen to open it without the browser's bars: tap
            <span class="hint__share"><app-icon name="share" /><span class="visually-hidden">Share</span></span>
            then <b>Add to Home Screen</b>.
          </p>
        } @else {
          <p class="hint__text">Install it as an app to open it without the browser's bars.</p>
        }
        <div class="hint__actions">
          @if (k === 'android') {
            <button type="button" class="hint__install" (click)="install()">Install</button>
          }
          <button type="button" class="hint__dismiss" (click)="dismiss()">{{ k === 'ios' ? 'Got it' : 'Not now' }}</button>
        </div>
      </aside>
    }
  `,
  styles: `
    .hint {
      position: fixed;
      z-index: 50;
      right: calc(0.75rem + env(safe-area-inset-right, 0px));
      bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
      left: calc(0.75rem + env(safe-area-inset-left, 0px));
      padding: 0.75rem 0.9rem;
      color: var(--paper);
      background: var(--olive-900);
      border: 1px solid var(--brass);
      border-radius: var(--radius);
      box-shadow: 0 6px 20px rgb(0 0 0 / 0.5);
      animation: hint-in 0.25s ease;
    }
    .hint__title {
      margin: 0 0 0.25rem;
      color: var(--smoke-yellow);
      font-family: var(--font-display);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .hint__text {
      margin: 0;
      font-size: 0.9rem;
      line-height: 1.45;
    }
    .hint__share {
      display: inline-grid;
      place-items: center;
      width: 1.5em;
      height: 1.5em;
      vertical-align: -0.35em;
      color: var(--smoke-yellow);
      border: 1px solid var(--olive-500);
      border-radius: 4px;
    }
    .hint__share app-icon {
      margin: 0;
    }
    .hint__actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 0.6rem;
    }
    .hint__install,
    .hint__dismiss {
      padding: 0.35rem 0.8rem;
      font: inherit;
      font-size: 0.85rem;
      border-radius: var(--radius);
      cursor: pointer;
    }
    .hint__install {
      color: var(--ink);
      background: var(--brass);
      border: 1px solid var(--brass);
    }
    .hint__dismiss {
      color: var(--khaki);
      background: none;
      border: 1px solid var(--olive-500);
    }
    .hint__install:focus-visible,
    .hint__dismiss:focus-visible {
      outline: 2px solid var(--smoke-yellow);
      outline-offset: 2px;
    }
    @keyframes hint-in {
      from {
        opacity: 0;
        transform: translateY(0.5rem);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .hint {
        animation: none;
      }
    }
  `,
})
export class InstallHint {
  /** Which hint shows: how to add it on an iPhone or iPad, Chrome's install on Android, or none. */
  protected readonly kind = signal<'ios' | 'android' | null>(null);
  /** Put away once, never shown again in this browser. */
  private readonly dismissed = storedFlag('installHint.dismissed', false);
  private prompt: InstallPromptEvent | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    // In the browser only: the server renders no hint.
    afterNextRender(() => {
      if (this.dismissed() || runningInstalled() || !narrowScreen()) {
        return;
      }
      if (isAppleMobile()) {
        const timer = setTimeout(() => this.kind.set('ios'), INSTALL_HINT_DELAY_MS);
        destroyRef.onDestroy(() => clearTimeout(timer));
        return;
      }
      // Chrome says when the site can be installed; its own mini bar is held back in favour of this hint.
      const offered = (event: Event) => {
        event.preventDefault();
        this.prompt = event as InstallPromptEvent;
        this.kind.set('android');
      };
      globalThis.addEventListener('beforeinstallprompt', offered);
      destroyRef.onDestroy(() => globalThis.removeEventListener('beforeinstallprompt', offered));
    });
  }

  protected async install(): Promise<void> {
    const prompt = this.prompt;
    this.dismiss();
    await prompt?.prompt();
  }

  protected dismiss(): void {
    this.kind.set(null);
    this.dismissed.set(true);
  }
}

/** Opened from the Home Screen already (Safari's own flag, or the display mode of an installed app elsewhere). */
function runningInstalled(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true || !!globalThis.matchMedia?.('(display-mode: standalone)').matches;
}

/** An iPhone or iPad (which calls itself a Mac, but has a touch screen), where only Safari's Share menu can add a site. */
function isAppleMobile(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
