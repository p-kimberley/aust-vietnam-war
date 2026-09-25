import { DestroyRef, Directive, ElementRef, Injector, afterNextRender, effect, inject, input, output } from '@angular/core';

/** How far below the visible part of the list its end may be when the next page is asked for, so it is usually there before it is reached. */
const AHEAD = '0px 0px 240px 0px';

/**
 * Infinite scroll: put it on an element after the last item of a list, and it asks for more (`appLoadMore`) as that element comes
 * into view in the list's scrolling box. While `busy` it waits; once not busy it looks again, so a page too short to fill the box is
 * followed by the next without the reader having to scroll. Remove the element when there is nothing more, or after a failure, so it
 * does not ask again. Where the browser cannot tell what is in view (no IntersectionObserver) it does nothing.
 */
@Directive({ selector: '[appLoadMore]' })
export class LoadMore {
  readonly busy = input(false);
  readonly appLoadMore = output<void>();

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private observer?: IntersectionObserver;

  constructor() {
    const injector = inject(Injector);
    effect(() => {
      if (!this.busy()) {
        afterNextRender(() => this.watch(), { injector });
      }
    });
    inject(DestroyRef).onDestroy(() => this.observer?.disconnect());
  }

  private watch(): void {
    this.observer?.disconnect();
    if (typeof IntersectionObserver === 'undefined' || this.busy()) {
      return;
    }
    // A new observer reports straight away whether the element is in view, which is what makes a short page ask for the next.
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          // Asked once; the next look is when the page has come (busy has gone back to false).
          this.observer?.disconnect();
          this.appLoadMore.emit();
        }
      },
      { root: scrollingBox(this.el), rootMargin: AHEAD },
    );
    this.observer.observe(this.el);
  }
}

/** The nearest box around the element that scrolls, or `null` for the page itself. */
function scrollingBox(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === 'auto' || y === 'scroll') {
      return p;
    }
  }
  return null;
}
