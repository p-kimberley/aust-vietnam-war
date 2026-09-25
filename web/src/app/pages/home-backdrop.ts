import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { Icon } from '../battlemap/icon';

/**
 * The photographs behind the home page banner, in the order they are shown. The files are made from the originals by
 * web/scripts/build-home-backdrops.py (toned to the site's palette, at 1920 and 960 pixels wide), which lists them in the same order.
 */
export const BACKDROPS: readonly { name: string; caption: string | null }[] = [
  { name: 'hammersley', caption: 'Operation Hammersley, February 1970: troops go back in after a B52 strike' },
  { name: 'patrol', caption: null },
  { name: 'fsb-ziggy', caption: 'Fire Support Base Ziggy' },
  { name: 'jungle-armour', caption: null },
  { name: 'long-hais-centurions', caption: 'Centurion tanks at the foot of the Long Hais' },
];

/** How long each photograph stays before the next fades in. */
export const BACKDROP_INTERVAL_MS = 10_000;

/**
 * A slow carousel of photographs behind the banner: each fades into the next every ten seconds. The photographs are decoration
 * (hidden from screen readers; the captions say what they show), and a button pauses them. For a reader who has asked for
 * less motion, the first stays still until they press play. Each photograph is only fetched when it is next in line.
 */
@Component({
  selector: 'app-home-backdrop',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bd" aria-hidden="true">
      @for (s of slides; track s.name; let i = $index) {
        @if (i <= ready()) {
          <img
            class="bd__img"
            [class.is-on]="i === current()"
            [src]="'/home/' + s.name + '-1920.jpg'"
            [attr.srcset]="'/home/' + s.name + '-960.jpg 960w, /home/' + s.name + '-1920.jpg 1920w'"
            sizes="100vw"
            alt=""
            decoding="async"
            [attr.fetchpriority]="i === 0 ? 'high' : null"
          />
        }
      }
    </div>
    <div class="bd__foot">
      @if (slides[current()].caption; as caption) {
        <p class="bd__caption">{{ caption }}</p>
      }
      <button type="button" class="bd__pause" [attr.aria-label]="paused() ? 'Play the banner photographs' : 'Pause the banner photographs'" (click)="toggle()">
        <app-icon [name]="paused() ? 'play' : 'pause'" />
      </button>
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }
    .bd,
    .bd__img {
      position: absolute;
      inset: 0;
    }
    .bd__img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transition: opacity 2.5s ease-in-out;
    }
    .bd__img.is-on {
      opacity: 1;
    }
    /* Keeps the banner's words readable: darkest behind them at the left, the photograph clearer to the right. */
    .bd::after {
      content: '';
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgb(31 35 20 / 0.9) 0%, rgb(31 35 20 / 0.72) 38%, rgb(31 35 20 / 0.2) 75%, rgb(31 35 20 / 0.1) 100%),
        linear-gradient(0deg, rgb(31 35 20 / 0.55) 0%, rgb(31 35 20 / 0) 30%);
    }
    .bd__foot {
      position: absolute;
      z-index: 2;
      right: 1rem;
      bottom: 0.75rem;
      left: 1rem;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.6rem;
    }
    .bd__caption {
      margin: 0;
      color: var(--khaki);
      font-size: 0.78rem;
      text-align: right;
      text-shadow: 0 1px 2px rgb(0 0 0 / 0.8);
    }
    .bd__pause {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 2rem;
      height: 2rem;
      padding: 0;
      color: var(--paper);
      background: rgb(31 35 20 / 0.6);
      border: 1px solid rgb(239 231 204 / 0.4);
      border-radius: 50%;
      cursor: pointer;
    }
    .bd__pause:hover {
      background: rgb(31 35 20 / 0.85);
    }
    .bd__pause:focus-visible {
      outline: 2px solid var(--smoke-yellow);
      outline-offset: 2px;
    }
    .bd__pause app-icon {
      margin: 0;
    }
    /* On a phone the words fill the width, so the photograph is dimmed evenly behind them. */
    @media (max-width: 45rem) {
      .bd::after {
        background: rgb(31 35 20 / 0.78);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bd__img {
        transition: none;
      }
    }
  `,
})
export class HomeBackdrop {
  protected readonly slides = BACKDROPS;
  protected readonly current = signal(0);
  /** The last photograph that may be fetched: the one showing and the one after it. */
  protected readonly ready = signal(Math.min(1, BACKDROPS.length - 1));
  protected readonly paused = signal(false);
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    // In the browser only: the server renders the first photograph and nothing moves.
    afterNextRender(() => {
      if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        this.paused.set(true);
      } else {
        this.start();
      }
    });
    inject(DestroyRef).onDestroy(() => clearInterval(this.timer));
  }

  protected toggle(): void {
    if (this.paused()) {
      this.paused.set(false);
      this.start();
    } else {
      this.paused.set(true);
      clearInterval(this.timer);
    }
  }

  private start(): void {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.next(), BACKDROP_INTERVAL_MS);
  }

  private next(): void {
    const at = (this.current() + 1) % BACKDROPS.length;
    this.current.set(at);
    this.ready.update((r) => Math.max(r, Math.min(at + 1, BACKDROPS.length - 1)));
  }
}
