import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';
import { Icon } from '../battlemap/icon';

/** How far down, in screen heights, the page must be scrolled before the button shows. */
export const SHOW_AFTER_SCREENS = 1;

/** A button at the bottom right that takes the reader back to the top of a long page; it shows once they have scrolled down. */
@Component({
  selector: 'app-scroll-top',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="top" [class.is-shown]="shown()" [attr.tabindex]="shown() ? null : -1" [attr.aria-hidden]="shown() ? null : true" aria-label="Scroll to top" title="Scroll to top" (click)="toTop()">
      <app-icon name="chevron-up" />
    </button>
  `,
  styles: `
    .top {
      position: fixed;
      z-index: 15;
      right: calc(1rem + env(safe-area-inset-right, 0px));
      bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      padding: 0;
      color: var(--khaki);
      background: var(--olive-900);
      border: 1px solid var(--olive-500);
      border-radius: 50%;
      box-shadow: 0 4px 14px rgb(0 0 0 / 0.35);
      cursor: pointer;
      opacity: 0;
      transform: translateY(0.5rem);
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .top.is-shown {
      opacity: 1;
      transform: none;
      pointer-events: auto;
    }
    .top:hover {
      color: var(--smoke-yellow);
      border-color: var(--smoke-yellow);
    }
    .top app-icon {
      margin: 0;
    }
  `,
})
export class ScrollTop {
  protected readonly shown = signal(false);
  private readonly doc = inject(DOCUMENT);

  constructor() {
    const destroyRef = inject(DestroyRef);
    // In the browser only: the server has no scrolling.
    afterNextRender(() => {
      const win = this.doc.defaultView;
      if (!win) return;
      const update = () => this.shown.set(win.scrollY > win.innerHeight * SHOW_AFTER_SCREENS);
      win.addEventListener('scroll', update, { passive: true });
      destroyRef.onDestroy(() => win.removeEventListener('scroll', update));
      update();
    });
  }

  protected toTop(): void {
    const win = this.doc.defaultView;
    const still = win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    win?.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
    // The keyboard goes back to the top too.
    this.doc.getElementById('main')?.focus({ preventScroll: true });
  }
}
