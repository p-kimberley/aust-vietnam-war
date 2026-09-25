import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadMore } from './load-more';
import { fakeScrolling } from './load-more-testing';

@Component({
  imports: [LoadMore],
  template: `<div style="overflow-y: auto"><p appLoadMore [busy]="busy()" (appLoadMore)="asked = asked + 1"></p></div>`,
})
class Host {
  readonly busy = signal(false);
  asked = 0;
}

function mount() {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(Host);
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { fixture, host: fixture.componentInstance, settle };
}

describe('LoadMore', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for more once as the end comes into view, waits while busy, and looks again when the page has come', async () => {
    const scrolling = fakeScrolling();
    const { host, settle } = mount();
    await settle();

    scrolling.reachEnd();
    expect(host.asked).toBe(1);
    host.busy.set(true);
    await settle();
    scrolling.reachEnd();
    expect(host.asked).toBe(1);

    host.busy.set(false);
    await settle();
    scrolling.reachEnd();
    expect(host.asked).toBe(2);
  });

  it('does nothing where the browser cannot tell what is in view', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { host, settle } = mount();
    await settle();

    expect(host.asked).toBe(0);
  });
});
