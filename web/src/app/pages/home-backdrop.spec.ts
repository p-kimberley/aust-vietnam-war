import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKDROPS, BACKDROP_INTERVAL_MS, HomeBackdrop } from './home-backdrop';

async function setup(reducedMotion = false) {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reducedMotion && q.includes('reduce') }));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(HomeBackdrop);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  };
  await settle();
  const imgs = () => [...el.querySelectorAll<HTMLImageElement>('img')];
  const showing = () => imgs().findIndex((i) => i.classList.contains('is-on'));
  const pause = () => el.querySelector<HTMLButtonElement>('.bd__pause')!;
  const caption = () => el.querySelector('.bd__caption')?.textContent?.trim() ?? null;
  return { fixture, el, settle, imgs, showing, pause, caption };
}

describe('the home page backdrop', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fades from one photograph to the next every ten seconds, round again after the last, with its caption', async () => {
    const { settle, showing, caption } = await setup();
    expect(showing()).toBe(0);
    expect(caption()).toBe(BACKDROPS[0].caption);

    await vi.advanceTimersByTimeAsync(BACKDROP_INTERVAL_MS - 1);
    await settle();
    expect(showing()).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(showing()).toBe(1);
    expect(caption()).toBe(BACKDROPS[1].caption);

    await vi.advanceTimersByTimeAsync(BACKDROP_INTERVAL_MS * (BACKDROPS.length - 1));
    await settle();
    expect(showing()).toBe(0);
  });

  it('fetches only the photograph showing and the ones either side, at a size to suit the screen', async () => {
    const { settle, imgs } = await setup();
    const last = BACKDROPS.length - 1;
    expect(imgs().map((i) => i.getAttribute('src'))).toEqual([0, 1, last].map((i) => `/home/${BACKDROPS[i].name}-1920.jpg`));
    expect(imgs()[0].getAttribute('srcset')).toContain('-960.jpg 960w');

    await vi.advanceTimersByTimeAsync(BACKDROP_INTERVAL_MS);
    await settle();
    expect(imgs()).toHaveLength(4);
  });

  it('steps back and forward from its buttons, round the ends, and waits a full ten seconds after', async () => {
    const { el, settle, showing } = await setup();
    const button = (label: string) => el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

    button('Previous photograph').click();
    await settle();
    expect(el.querySelector('img.is-on')?.getAttribute('src')).toBe(`/home/${BACKDROPS[BACKDROPS.length - 1].name}-1920.jpg`);

    button('Next photograph').click();
    button('Next photograph').click();
    await settle();
    expect(el.querySelector('img.is-on')?.getAttribute('src')).toBe(`/home/${BACKDROPS[1].name}-1920.jpg`);

    await vi.advanceTimersByTimeAsync(BACKDROP_INTERVAL_MS - 1);
    await settle();
    expect(el.querySelector('img.is-on')?.getAttribute('src')).toBe(`/home/${BACKDROPS[1].name}-1920.jpg`);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(el.querySelector('img.is-on')?.getAttribute('src')).toBe(`/home/${BACKDROPS[2].name}-1920.jpg`);
  });

  it('keeps the photographs from screen readers, and pauses and plays them from a named button', async () => {
    const { el, settle, showing, pause } = await setup();
    expect(el.querySelector('.bd')?.getAttribute('aria-hidden')).toBe('true');
    expect(pause().getAttribute('aria-label')).toBe('Pause the banner photographs');

    pause().click();
    await settle();
    await vi.advanceTimersByTimeAsync(BACKDROP_INTERVAL_MS * 3);
    await settle();
    expect(showing()).toBe(0);
    expect(pause().getAttribute('aria-label')).toBe('Play the banner photographs');

    pause().click();
    await settle();
    await vi.advanceTimersByTimeAsync(BACKDROP_INTERVAL_MS);
    await settle();
    expect(showing()).toBe(1);
  });

  it('stays still for a reader who has asked for less motion, until they press play', async () => {
    const { settle, showing, pause } = await setup(true);
    expect(pause().getAttribute('aria-label')).toBe('Play the banner photographs');

    await vi.advanceTimersByTimeAsync(BACKDROP_INTERVAL_MS * 2);
    await settle();
    expect(showing()).toBe(0);
  });
});
