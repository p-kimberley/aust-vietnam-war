import { DOCUMENT } from '@angular/common';
import { Injectable, OnDestroy, inject } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subscription } from 'rxjs';

/** How long a page is given to grow tall enough to be put back where it was (its content may still be loading). */
export const RESTORE_WITHIN_MS = 2000;

/**
 * Puts a page back where the reader left it when they go Back (or Forward) to it: to the Battle Map from an article or a unit's
 * history and back, say. Where each page was scrolled to is noted, by its address, as the reader leaves it; going Back to it, the
 * page is scrolled there again once it is tall enough (its content may arrive after the page is made). Other navigations are left
 * as they were. Kept for the visit, as the browser keeps its history. Browser only: `start` is called once, by the app.
 */
@Injectable({ providedIn: 'root' })
export class ScrollMemory implements OnDestroy {
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly positions = new Map<string, number>();
  private subscription?: Subscription;
  private frame = 0;

  /** Where the page at this address was left, if it has been. */
  positionOf(url: string): number | undefined {
    return this.positions.get(url);
  }

  start(): void {
    const win = this.doc.defaultView;
    if (!win || this.subscription) return;
    let popped = false;
    this.subscription = this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        // The address is still the page's being left.
        this.positions.set(this.router.url, win.scrollY);
        popped = e.navigationTrigger === 'popstate';
        win.cancelAnimationFrame(this.frame);
      } else if (e instanceof NavigationEnd && popped) {
        const top = this.positions.get(e.urlAfterRedirects);
        if (top !== undefined) this.restore(top, win);
      }
    });
  }

  /** Scrolls to `top` once the page is tall enough, trying each frame for a while; the reader scrolling first wins. */
  private restore(top: number, win: Window): void {
    const until = Date.now() + RESTORE_WITHIN_MS;
    let last: number | null = null;
    const attempt = () => {
      // The reader has scrolled since the last attempt: leave the page where they put it.
      if (last !== null && Math.abs(win.scrollY - last) > 1) return;
      win.scrollTo({ top });
      last = win.scrollY;
      if (Math.abs(win.scrollY - top) > 1 && Date.now() < until) this.frame = win.requestAnimationFrame(attempt);
    };
    this.frame = win.requestAnimationFrame(attempt);
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
