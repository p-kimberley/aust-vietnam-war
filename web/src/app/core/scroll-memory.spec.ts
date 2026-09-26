import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Event, NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ScrollMemory } from './scroll-memory';

const frames = () => new Promise((r) => setTimeout(r, 50));

function setup() {
  const events = new Subject<Event>();
  const router = { events, url: '/features/unit-histories/5-rar' };
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: Router, useValue: router }] });
  const memory = TestBed.inject(ScrollMemory);
  memory.start();
  let y = 0;
  Object.defineProperty(window, 'scrollY', { get: () => y, configurable: true });
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(((o: ScrollToOptions) => (y = o.top ?? y)) as never);
  scrollTo.mockClear();
  const go = (id: number, url: string, trigger: 'imperative' | 'popstate') => {
    events.next(new NavigationStart(id, url, trigger));
    router.url = url;
    events.next(new NavigationEnd(id, url, url));
  };
  return { memory, go, scrollTo, scrollBy: (to: number) => (y = to) };
}

describe('ScrollMemory', () => {
  it('puts a page back where the reader left it when they go Back to it, and leaves other navigations alone', async () => {
    const { memory, go, scrollTo, scrollBy } = setup();
    scrollBy(8600);

    go(1, '/battlemap?person=1', 'imperative');
    await frames();
    expect(memory.positionOf('/features/unit-histories/5-rar')).toBe(8600);
    expect(scrollTo).not.toHaveBeenCalled();

    scrollBy(0);
    go(2, '/features/unit-histories/5-rar', 'popstate');
    await frames();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 8600 });
  });

  it('does nothing going Back to a page it has no note of', async () => {
    const { go, scrollTo } = setup();

    go(1, '/articles/somewhere', 'popstate');
    await frames();

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
