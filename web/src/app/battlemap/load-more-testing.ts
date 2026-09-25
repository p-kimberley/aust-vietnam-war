import { vi } from 'vitest';

/**
 * Stands in for the browser's IntersectionObserver (jsdom has none), so a spec can scroll a list to its end: `reachEnd()` tells every
 * element being watched that it has come into view. Undo with `vi.unstubAllGlobals()`.
 */
export function fakeScrolling() {
  const watching = new Set<FakeObserver>();

  class FakeObserver {
    private readonly targets: Element[] = [];
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(el: Element): void {
      this.targets.push(el);
      watching.add(this);
    }
    unobserve(): void {
      watching.delete(this);
    }
    disconnect(): void {
      watching.delete(this);
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    reveal(): void {
      this.callback(this.targets.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry), this as unknown as IntersectionObserver);
    }
  }

  vi.stubGlobal('IntersectionObserver', FakeObserver);
  return {
    /** How many elements are waiting to come into view. */
    watched: () => watching.size,
    reachEnd(): void {
      for (const o of [...watching]) o.reveal();
    },
  };
}
