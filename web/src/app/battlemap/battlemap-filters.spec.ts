import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { render, settle } from './battlemap-testing';
import { CONTACTS } from './filter-fixtures';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SEARCH_WAIT = 480; // the page waits 400 ms for typing to pause

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();
const countText = (el: HTMLElement) => text(el.querySelector('.bm__count'));

/** The point features last given to the map: the first `addSource` call, then every `setData`. */
function plotted(basemaps: Awaited<ReturnType<typeof render>>['basemaps']): number[] {
  const calls = basemaps.map.setData.mock.calls;
  const data = calls.length ? calls[calls.length - 1][0] : (basemaps.map.addSource.mock.calls[0][1] as { data: unknown }).data;
  return (data as { features: { id: number }[] }).features.map((f) => f.id);
}

async function openFilters(r: Awaited<ReturnType<typeof render>>) {
  r.el.querySelector<HTMLButtonElement>('#tab-filters')!.click();
  await settle(r.fixture);
}

describe('Battle Map filters', () => {
  it('starts on the layers tab with every contact plotted', async () => {
    const r = await render({ contacts: CONTACTS });

    expect(r.el.querySelector('#tab-layers')!.getAttribute('aria-selected')).toBe('true');
    expect(r.el.querySelector('app-filters-panel')).toBeNull();
    expect(countText(r.el)).toBe('4 contacts');
    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
  });

  it('opens the filters tab and shows how many contacts pass', async () => {
    const r = await render({ contacts: CONTACTS });

    await openFilters(r);

    expect(r.el.querySelector('#tab-filters')!.getAttribute('aria-selected')).toBe('true');
    expect(text(r.el.querySelector('.summary__count'))).toBe('4 of 4 contacts');
  });

  it('redraws the map with only the matching contacts, and rescales the heatmap to them', async () => {
    const r = await render({ contacts: CONTACTS });
    await openFilters(r);
    r.basemaps.map.setPaintProperty.mockClear();

    r.el.querySelector<HTMLInputElement>('input[name=mine][value=yes]')!.click();     // only contact 2 has a mine incident
    await settle(r.fixture);

    expect(plotted(r.basemaps)).toEqual([2]);
    expect(countText(r.el)).toBe('1 of 4 contacts');
    expect(text(r.el.querySelector('.summary__count'))).toBe('1 of 4 contacts');
    expect(r.basemaps.map.setPaintProperty).toHaveBeenCalledWith('avw-contacts-heat', 'heatmap-weight', expect.anything());
  });

  it('badges the tab with how many filters are active, and clears them from a chip', async () => {
    const r = await render({ contacts: CONTACTS });
    await openFilters(r);

    r.el.querySelector<HTMLInputElement>('input[name=mine][value=yes]')!.click();
    await settle(r.fixture);
    expect(text(r.el.querySelector('#tab-filters .badge'))).toBe('1');

    r.el.querySelector<HTMLButtonElement>('.chip')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('#tab-filters .badge')).toBeNull();
    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
    expect(countText(r.el)).toBe('4 contacts');
  });

  it('filters by a unit chosen in the tree', async () => {
    const r = await render({ contacts: CONTACTS });
    await openFilters(r);

    r.el.querySelector<HTMLInputElement>('app-unit-tree input[type=checkbox]')!.click();     // 1 RAR and everything under it
    await settle(r.fixture);

    expect(plotted(r.basemaps)).toEqual([1, 2]);
  });

  it('keeps the filtered view when the basemap style is reloaded', async () => {
    const r = await render({ contacts: CONTACTS });
    await openFilters(r);
    r.el.querySelector<HTMLInputElement>('input[name=mine][value=yes]')!.click();
    await settle(r.fixture);

    // A style change discards custom layers, and the page adds them again from what is currently visible.
    r.basemaps.map.sources.clear();
    r.basemaps.map.layers.clear();
    r.basemaps.map.addSource.mockClear();
    r.basemaps.hooks!.styleLoaded(r.basemaps.map as never);

    expect((r.basemaps.map.addSource.mock.calls[0][1] as { data: { features: unknown[] } }).data.features).toHaveLength(1);
  });

  it('writes the filters into the URL', async () => {
    const r = await render({ contacts: CONTACTS });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await openFilters(r);

    r.el.querySelector<HTMLInputElement>('input[name=mine][value=yes]')!.click();
    await settle(r.fixture);
    r.el.querySelector<HTMLInputElement>('app-unit-tree input[type=checkbox]')!.click();
    await wait(450);

    const params = navigate.mock.calls.at(-1)![1]!.queryParams!;
    expect(params).toMatchObject({ mine: 'yes', units: '3233', ops: null, q: null });
  });
});

describe('Battle Map report search', () => {
  async function typeSearch(r: Awaited<ReturnType<typeof render>>, value: string) {
    const box = r.el.querySelector<HTMLInputElement>('input.text')!;
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    r.fixture.detectChanges();
  }

  it('waits for typing to pause, searches once, and applies the answer', async () => {
    const r = await render({ contacts: CONTACTS, search: () => Promise.resolve([2, 3]) });
    await openFilters(r);

    await typeSearch(r, 'cl');
    await typeSearch(r, 'claymore');
    expect(r.filterService.search).not.toHaveBeenCalled();
    expect(text(r.el.querySelector('.hint[role=status]'))).toBe('Searching…');

    await wait(SEARCH_WAIT);
    await settle(r.fixture);

    expect(r.filterService.search).toHaveBeenCalledTimes(1);
    expect(r.filterService.search).toHaveBeenCalledWith('claymore');
    expect(plotted(r.basemaps)).toEqual([2, 3]);
    expect(text(r.el.querySelector('.summary__count'))).toBe('2 of 4 contacts');
  });

  it('does not search for text that is too short', async () => {
    const r = await render({ contacts: CONTACTS });
    await openFilters(r);

    await typeSearch(r, 'c');
    await wait(SEARCH_WAIT);

    expect(r.filterService.search).not.toHaveBeenCalled();
    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
  });

  it('drops the report filter when the text is cleared', async () => {
    const r = await render({ contacts: CONTACTS, search: () => Promise.resolve([2]) });
    await openFilters(r);
    await typeSearch(r, 'claymore');
    await wait(SEARCH_WAIT);
    await settle(r.fixture);
    expect(plotted(r.basemaps)).toEqual([2]);

    await typeSearch(r, '');
    await settle(r.fixture);

    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
    expect(r.filterService.search).toHaveBeenCalledTimes(1);
  });

  it('ignores a slow answer to an older search', async () => {
    const pending: ((ids: number[]) => void)[] = [];
    const r = await render({ contacts: CONTACTS, search: () => new Promise<number[]>((resolve) => pending.push(resolve)) });
    await openFilters(r);

    await typeSearch(r, 'first');
    await wait(SEARCH_WAIT);
    await typeSearch(r, 'second');
    await wait(SEARCH_WAIT);
    expect(pending).toHaveLength(2);

    pending[1]([3]);                                        // the newer search answers first
    await settle(r.fixture);
    pending[0]([1]);                                        // the older one arrives late and must be ignored
    await settle(r.fixture);

    expect(plotted(r.basemaps)).toEqual([3]);
  });

  it('says so when the search fails and leaves the map unfiltered by it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await render({ contacts: CONTACTS, search: () => Promise.reject(new Error('boom')) });
    await openFilters(r);

    await typeSearch(r, 'claymore');
    await wait(SEARCH_WAIT);
    await settle(r.fixture);

    expect(text(r.el.querySelector('.hint[role=status]'))).toBe('The search failed. Try again in a moment.');
    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
    warn.mockRestore();
  });
});

describe('Battle Map opened from a link with filters', () => {
  it('applies the filters before the first draw and opens the filters tab', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { mine: 'yes', units: '3233' } });

    expect(r.el.querySelector('#tab-filters')!.getAttribute('aria-selected')).toBe('true');
    expect(text(r.el.querySelector('.summary__count'))).toBe('1 of 4 contacts');
    expect(plotted(r.basemaps)).toEqual([2]);
    expect(r.el.querySelector('input[name=mine][value=yes]')).toHaveProperty('checked', true);
  });

  it('searches for report text straight away and waits for the answer before drawing', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { q: 'claymore' }, search: () => Promise.resolve([3, 4]) });

    expect(r.filterService.search).toHaveBeenCalledWith('claymore');
    expect(plotted(r.basemaps)).toEqual([3, 4]);
  });

  it('still opens if that search fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await render({ contacts: CONTACTS, queryParams: { q: 'claymore' }, search: () => Promise.reject(new Error('down')) });

    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
    expect(r.el.querySelector('.bm__count')).not.toBeNull();
    warn.mockRestore();
  });

  it('ignores filter values that mean nothing', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { mine: 'maybe', fr: 'x', units: '999999', ops: 'Not an operation' } });

    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
    expect(r.el.querySelector('#tab-layers')!.getAttribute('aria-selected')).toBe('true');
  });

  it('opens on the layers tab when the link has no filters', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { at: '10.6,107.2,11' } });
    expect(r.el.querySelector('#tab-layers')!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('Battle Map without the filter catalogue', () => {
  it('still shows every contact and explains that filters are unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await render({ contacts: CONTACTS, catalogue: new Error('down') });

    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
    expect(countText(r.el)).toBe('4 contacts');

    await openFilters(r);
    expect(text(r.el.querySelector('.panel__note'))).toContain('The filters could not be loaded');
    expect(r.el.querySelector('app-filters-panel')).toBeNull();
    warn.mockRestore();
  });
});
