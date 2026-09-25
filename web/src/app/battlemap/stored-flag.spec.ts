import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, settle } from './battlemap-testing';
import { NARROW_SCREEN, STORED_FLAG_PREFIX, storedFlag } from './stored-flag';

describe('storedFlag', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });
  const flag = (initial: boolean) => TestBed.runInInjectionContext(() => storedFlag('test.flag', initial));

  it('starts at its default on a first visit, and keeps each change', () => {
    const open = flag(true);
    expect(open()).toBe(true);

    open.set(false);
    TestBed.tick();

    expect(localStorage.getItem(STORED_FLAG_PREFIX + 'test.flag')).toBe('false');
  });

  it('starts as the browser last kept it', () => {
    localStorage.setItem(STORED_FLAG_PREFIX + 'test.flag', 'false');

    expect(flag(true)()).toBe(false);
  });

  it('ignores something kept there that is not a yes or a no', () => {
    localStorage.setItem(STORED_FLAG_PREFIX + 'test.flag', 'maybe');

    expect(flag(true)()).toBe(true);
  });

  it('still works when the browser keeps nothing', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is off');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is off');
    });
    try {
      const open = flag(false);
      open.set(true);
      TestBed.tick();
      expect(open()).toBe(true);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe('the Battle Map remembers what was left shut', () => {
  it('keeps it when the Layers and Filters panel is hidden or the legend closed', async () => {
    const r = await render();

    r.el.querySelector<HTMLButtonElement>('.panel__toggle')!.click();
    r.el.querySelector<HTMLButtonElement>('.legend__toggle')!.click();
    await settle(r.fixture);

    expect(localStorage.getItem(STORED_FLAG_PREFIX + 'battlemap.panelOpen')).toBe('false');
    expect(localStorage.getItem(STORED_FLAG_PREFIX + 'battlemap.legendOpen')).toBe('false');
  });

  it('starts the next visit with them as they were left', async () => {
    const r = await render({ stored: { [STORED_FLAG_PREFIX + 'battlemap.panelOpen']: 'false', [STORED_FLAG_PREFIX + 'battlemap.legendOpen']: 'false' } });

    expect(r.el.querySelector('.panel__toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(r.el.querySelector('.legend__toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('starts a first visit with both open', async () => {
    const r = await render();

    expect(r.el.querySelector('.panel__toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(r.el.querySelector('.legend__toggle')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the panel button as an arrow that points the way it will move the panel, named for what it does', async () => {
    const r = await render();
    const toggle = r.el.querySelector<HTMLButtonElement>('.panel__toggle')!;
    expect(toggle.getAttribute('aria-label')).toBe('Hide map controls');
    expect(toggle.querySelector('app-icon path')?.getAttribute('d')).toBe('m18 15-6-6-6 6');

    toggle.click();
    await settle(r.fixture);

    expect(toggle.getAttribute('aria-label')).toBe('Show map controls');
    expect(toggle.querySelector('app-icon path')?.getAttribute('d')).toBe('m6 9 6 6 6-6');
  });

  describe('on a phone', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN }));
      return () => vi.unstubAllGlobals();
    });

    it('starts a first visit with both shut, so the map shows', async () => {
      const r = await render();

      expect(r.el.querySelector('.panel__toggle')?.getAttribute('aria-expanded')).toBe('false');
      expect(r.el.querySelector('.legend__toggle')?.getAttribute('aria-expanded')).toBe('false');
    });

    it('still opens them if they were left open', async () => {
      const r = await render({ stored: { [STORED_FLAG_PREFIX + 'battlemap.panelOpen']: 'true', [STORED_FLAG_PREFIX + 'battlemap.legendOpen']: 'true' } });

      expect(r.el.querySelector('.panel__toggle')?.getAttribute('aria-expanded')).toBe('true');
      expect(r.el.querySelector('.legend__toggle')?.getAttribute('aria-expanded')).toBe('true');
    });
  });
});
