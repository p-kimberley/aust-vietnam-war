import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { render, settle } from './battlemap-testing';
import { CONTACTS } from './filter-fixtures';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SEARCH_WAIT = 480; // the page waits 400 ms for typing to pause

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

/** The point features last given to the map: the first `addSource` call, then every `setData`. */
function plotted(basemaps: Awaited<ReturnType<typeof render>>['basemaps']): number[] {
  const calls = basemaps.map.setData.mock.calls;
  const data = calls.length ? calls[calls.length - 1][0] : (basemaps.map.addSource.mock.calls.find((c) => c[0] === 'avw-contacts')![1] as { data: unknown }).data;
  return (data as { features: { id: number }[] }).features.map((f) => f.id);
}

async function openFilters(r: Awaited<ReturnType<typeof render>>) {
  r.el.querySelector<HTMLButtonElement>('#right-tab-filters')!.click();
  await settle(r.fixture);
}

describe('Battle Map filters', () => {
  it('starts on the layers tab with every contact plotted', async () => {
    const r = await render({ contacts: CONTACTS });

    expect(r.el.querySelector('#right-tab-layers')!.getAttribute('aria-selected')).toBe('true');
    expect(r.el.querySelector('app-filters-panel')).toBeNull();
    expect(r.el.querySelector('.bm__count')).toBeNull();      // the top bar carries no total
    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
  });

  it('opens the filters tab and shows how many contacts pass', async () => {
    const r = await render({ contacts: CONTACTS });

    await openFilters(r);

    expect(r.el.querySelector('#right-tab-filters')!.getAttribute('aria-selected')).toBe('true');
    expect(text(r.el.querySelector('.summary__count'))).toBe('4 of 4 contacts');
  });

  it('redraws the map with only the matching contacts, and rescales the heatmap to them', async () => {
    const r = await render({ contacts: CONTACTS });
    await openFilters(r);
    r.basemaps.map.setPaintProperty.mockClear();

    r.el.querySelector<HTMLInputElement>('input[name=mine][value=yes]')!.click();     // only contact 2 has a mine incident
    await settle(r.fixture);

    expect(plotted(r.basemaps)).toEqual([2]);
    expect(text(r.el.querySelector('.summary__count'))).toBe('1 of 4 contacts');
    expect(r.basemaps.map.setPaintProperty).toHaveBeenCalledWith('avw-contacts-heat', 'heatmap-weight', expect.anything());
  });

  it('badges the tab with how many filters are active, and clears them from a chip', async () => {
    const r = await render({ contacts: CONTACTS });
    await openFilters(r);

    r.el.querySelector<HTMLInputElement>('input[name=mine][value=yes]')!.click();
    await settle(r.fixture);
    expect(text(r.el.querySelector('#right-tab-filters .tab__badge'))).toBe('1');

    r.el.querySelector<HTMLButtonElement>('.chip')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('#right-tab-filters .tab__badge')).toBeNull();
    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
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

    const contactSource = r.basemaps.map.addSource.mock.calls.find((c) => c[0] === 'avw-contacts')!;
    expect((contactSource[1] as { data: { features: unknown[] } }).data.features).toHaveLength(1);
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

    expect(r.el.querySelector('#right-tab-filters')!.getAttribute('aria-selected')).toBe('true');
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
    expect(r.el.querySelector('app-timeline')).not.toBeNull();
    warn.mockRestore();
  });

  it('ignores filter values that mean nothing', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { mine: 'maybe', fr: 'x', units: '999999', ops: 'Not an operation' } });

    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
    expect(r.el.querySelector('#right-tab-layers')!.getAttribute('aria-selected')).toBe('true');
  });

  it('opens on the layers tab when the link has no filters', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { at: '10.6,107.2,11' } });
    expect(r.el.querySelector('#right-tab-layers')!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('Battle Map without the filter catalogue', () => {
  it('still shows every contact and explains that filters are unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await render({ contacts: CONTACTS, catalogue: new Error('down') });

    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);

    await openFilters(r);
    expect(text(r.el.querySelector('.panel__note'))).toContain('The filters could not be loaded');
    expect(r.el.querySelector('app-filters-panel')).toBeNull();
    warn.mockRestore();
  });
});

describe('Battle Map operation timeline', () => {
  const rows = (r: Awaited<ReturnType<typeof render>>) => [...r.el.querySelectorAll<HTMLElement>('app-timeline [role=option]')];
  const named = (r: Awaited<ReturnType<typeof render>>, name: string) => rows(r).find((row) => row.querySelector('.row__name')!.firstChild!.textContent === name)!;
  const click = async (r: Awaited<ReturnType<typeof render>>, name: string) => {
    named(r, name).click();
    await settle(r.fixture);
  };

  it('opens from the arrow on the timeline, and makes the timeline taller for it', async () => {
    const r = await render({ contacts: CONTACTS });
    const arrow = r.el.querySelector<HTMLButtonElement>('app-timeline .tl__toggle')!;
    const bm = r.el.querySelector('.bm')!;
    expect(bm.classList.contains('bm--timeline-open')).toBe(false);

    arrow.click();
    await settle(r.fixture);
    expect(bm.classList.contains('bm--timeline-open')).toBe(true);
    expect(rows(r).map((row) => row.querySelector('.row__name')!.firstChild!.textContent)).toEqual(['Hardihood, Phase 2', 'Coburg']);

    arrow.click();
    await settle(r.fixture);
    expect(bm.classList.contains('bm--timeline-open')).toBe(false);
  });

  it('filters the map to an operation when it is clicked, and back again when it is clicked a second time', async () => {
    const r = await render({ contacts: CONTACTS });
    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);

    await click(r, 'Coburg');
    expect(plotted(r.basemaps)).toEqual([2]);
    expect(named(r, 'Coburg').getAttribute('aria-selected')).toBe('true');
    expect(r.el.querySelector('#right-tab-filters .tab__badge')?.textContent).toBe('1');

    await click(r, 'Coburg');
    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
    expect(named(r, 'Coburg').getAttribute('aria-selected')).toBe('false');
    expect(r.el.querySelector('#right-tab-filters .tab__badge')).toBeNull();
  });

  it('takes any number of operations at once, and drops each one as it is clicked off', async () => {
    const r = await render({ contacts: CONTACTS });

    await click(r, 'Coburg');
    await click(r, 'Hardihood, Phase 2');
    expect(plotted(r.basemaps)).toEqual([1, 2, 4]);
    expect(rows(r).map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'true']);

    await click(r, 'Coburg');
    expect(plotted(r.basemaps)).toEqual([1, 4]);

    await click(r, 'Hardihood, Phase 2');
    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
  });

  it('is the same filter as the Operation list in the Filters tab', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { ops: 'Coburg' } });

    expect(named(r, 'Coburg').getAttribute('aria-selected')).toBe('true');
    expect(plotted(r.basemaps)).toEqual([2]);

    await openFilters(r);
    r.el.querySelector<HTMLInputElement>('app-checklist-filter input[type=checkbox]:checked')!.click();
    await settle(r.fixture);

    expect(named(r, 'Coburg').getAttribute('aria-selected')).toBe('false');
    expect(plotted(r.basemaps)).toEqual([1, 2, 3, 4]);
  });
});
