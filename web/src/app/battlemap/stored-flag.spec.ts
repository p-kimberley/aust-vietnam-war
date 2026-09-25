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
  const tab = (r: Awaited<ReturnType<typeof render>>, id: string) => r.el.querySelector<HTMLButtonElement>(`#right-tab-${id}`)!;
  const rightOpen = (r: Awaited<ReturnType<typeof render>>) => r.el.querySelector('#right-flyout')!.classList.contains('is-open');
  const kept = (key: string) => localStorage.getItem(STORED_FLAG_PREFIX + key);

  it('keeps it when the Layers or Filters panel is shut, which of them was showing, and the legend closed', async () => {
    const r = await render();

    tab(r, 'filters').click();
    await settle(r.fixture);
    expect(kept('battlemap.rightTab')).toBe('filters');

    tab(r, 'filters').click();
    r.el.querySelector<HTMLButtonElement>('.legend__toggle')!.click();
    await settle(r.fixture);

    expect(kept('battlemap.panelOpen')).toBe('false');
    expect(kept('battlemap.rightTab')).toBe('filters');
    expect(kept('battlemap.legendOpen')).toBe('false');
  });

  it('starts the next visit with them as they were left', async () => {
    const r = await render({ stored: { [STORED_FLAG_PREFIX + 'battlemap.panelOpen']: 'false', [STORED_FLAG_PREFIX + 'battlemap.legendOpen']: 'false' } });

    expect(rightOpen(r)).toBe(false);
    expect(tab(r, 'layers').getAttribute('aria-selected')).toBe('false');
    expect(r.el.querySelector('.legend__toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the next visit on Filters when that was showing', async () => {
    const r = await render({ stored: { [STORED_FLAG_PREFIX + 'battlemap.rightTab']: 'filters' } });

    expect(rightOpen(r)).toBe(true);
    expect(tab(r, 'filters').getAttribute('aria-selected')).toBe('true');
    expect(r.el.querySelector('app-filters-panel')).not.toBeNull();
  });

  it('ignores a kept panel it does not know', async () => {
    const r = await render({ stored: { [STORED_FLAG_PREFIX + 'battlemap.rightTab']: 'charts' } });

    expect(tab(r, 'layers').getAttribute('aria-selected')).toBe('true');
  });

  it('starts a first visit with Layers and the legend open', async () => {
    const r = await render();

    expect(rightOpen(r)).toBe(true);
    expect(tab(r, 'layers').getAttribute('aria-selected')).toBe('true');
    expect(r.el.querySelector('#right-title')?.textContent).toBe('Layers');
    expect(r.el.querySelector('.legend__toggle')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('shuts the panel from its close button, and from its tab', async () => {
    const r = await render();

    r.el.querySelector<HTMLButtonElement>('.panel__close')!.click();
    await settle(r.fixture);
    expect(rightOpen(r)).toBe(false);

    tab(r, 'layers').click();
    await settle(r.fixture);
    expect(rightOpen(r)).toBe(true);
    tab(r, 'layers').click();
    await settle(r.fixture);
    expect(rightOpen(r)).toBe(false);
  });

  it('gives each rail tab an icon', async () => {
    const r = await render();

    const icons = [...r.el.querySelectorAll('app-left-tabs [role=tab]')].map((t) => !!t.querySelector('app-icon path')?.getAttribute('d'));
    expect(icons).toEqual([true, true, true, true, true]);
  });

  describe('on a phone', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN }));
      return () => vi.unstubAllGlobals();
    });

    it('starts a first visit with both shut, so the map shows', async () => {
      const r = await render();

      expect(rightOpen(r)).toBe(false);
      expect(r.el.querySelector('.legend__toggle')?.getAttribute('aria-expanded')).toBe('false');
    });

    it('still opens them if they were left open', async () => {
      const r = await render({ stored: { [STORED_FLAG_PREFIX + 'battlemap.panelOpen']: 'true', [STORED_FLAG_PREFIX + 'battlemap.legendOpen']: 'true' } });

      expect(rightOpen(r)).toBe(true);
      expect(r.el.querySelector('.legend__toggle')?.getAttribute('aria-expanded')).toBe('true');
    });
  });
});
