import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { REFRESH_DELAY_MS } from './analytics/analytics-panel';
import { StubEChart } from './analytics/echart-stub';
import { dayMs } from './analytics/timeline';
import { render, settle } from './battlemap-testing';
import { NO_FILTERS } from './filters';
import { CONTACTS } from './filter-fixtures';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Rendered = Awaited<ReturnType<typeof render>>;

/** The chart inside the timeline strip, which stands in for the real one. */
const timelineChart = (r: Rendered) => r.fixture.debugElement.query((d) => d.name === 'app-timeline').query((d) => d.componentInstance instanceof StubEChart).componentInstance as StubEChart;

/** The contacts the map was last told to draw: the latest data set, or what it started with. */
const shownIds = (r: Rendered) => {
  const initial = r.basemaps.map.addSource.mock.calls.find(([id]) => id === 'avw-contacts')?.[1] as { data: unknown };
  const data = (r.basemaps.map.setData.mock.calls.at(-1)?.[0] ?? initial.data) as { features: { properties: { id: number } }[] };
  return data.features.map((f) => f.properties.id);
};

const button = (r: Rendered, text: string) => [...r.el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;

describe('Battle Map timeline', () => {
  it('shows the timeline along the bottom once the map is ready, and not before', async () => {
    const ready = await render({ contacts: CONTACTS });
    expect(ready.el.querySelector('.bm__timeline app-timeline')).not.toBeNull();

    TestBed.resetTestingModule();
    const failed = await render({ contacts: new Error('down') });
    expect(failed.el.querySelector('app-timeline')).toBeNull();
  });

  it('sets the date filter when the reader picks a stretch of time, and the map redraws with only those contacts', async () => {
    const r = await render({ contacts: CONTACTS });
    expect(shownIds(r)).toEqual([1, 2, 3, 4]);

    timelineChart(r).zoomed.emit({ start: dayMs('1966-03-01'), end: dayMs('1966-04-01') });
    await settle(r.fixture);

    expect(shownIds(r)).toEqual([1, 2]);
    expect(r.el.querySelector('.bm__count')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('2 of 4 contacts');
    expect(r.el.querySelector('#tab-filters .badge')?.textContent).toBe('1');
  });

  it('follows a date range set in the filter panel, and clears it with "Whole war"', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { from: '1966-03-04', to: '1966-03-31' } });

    expect(r.el.querySelector('.tl__range')?.textContent).toBe('1966-03-04 to 1966-03-31');
    expect(shownIds(r)).toEqual([2]);

    button(r, 'Whole war').click();
    await settle(r.fixture);

    expect(shownIds(r)).toEqual([1, 2, 3, 4]);
    expect(r.el.querySelector('.tl__range')?.textContent).toBe('The whole war');
  });
});

describe('Battle Map charts', () => {
  it('opens and closes the charts drawer from the top bar', async () => {
    const r = await render({ contacts: CONTACTS });
    expect(r.el.querySelector('app-analytics-panel')).toBeNull();
    expect(button(r, 'Charts').getAttribute('aria-pressed')).toBe('false');

    button(r, 'Charts').click();
    await settle(r.fixture);
    expect(r.el.querySelector('app-analytics-panel')).not.toBeNull();
    expect(button(r, 'Charts').getAttribute('aria-pressed')).toBe('true');

    r.el.querySelector<HTMLButtonElement>('.ap__close')!.click();
    await settle(r.fixture);
    expect(r.el.querySelector('app-analytics-panel')).toBeNull();
  });

  it('opens straight onto the charts from a shared link', async () => {
    const r = await render({ contacts: CONTACTS, inputs: { charts: '1' } });

    expect(r.el.querySelector('app-analytics-panel')).not.toBeNull();
  });

  it('draws from every contact while nothing is filtered, and from the contacts the map shows once something is', async () => {
    const r = await render({ contacts: CONTACTS, inputs: { charts: '1' } });
    await wait(20);
    await settle(r.fixture);
    expect(r.analytics.draw).toHaveBeenLastCalledWith('battle-damage-date', null);

    timelineChart(r).zoomed.emit({ start: dayMs('1966-03-01'), end: dayMs('1966-04-01') });
    await settle(r.fixture);
    await wait(REFRESH_DELAY_MS + 100);
    await settle(r.fixture);

    expect(r.analytics.draw).toHaveBeenLastCalledWith('battle-damage-date', [1, 2]);
  });
});

describe('Battle Map unit tracks', () => {
  /** What the track source was last given: newer data if it was replaced, otherwise what it was created with. */
  const trackData = (r: Rendered) =>
    (r.basemaps.map.dataFor('avw-tracks').mock.calls.at(-1)?.[0] ?? (r.basemaps.map.addSource.mock.calls.find(([id]) => id === 'avw-tracks')?.[1] as { data: unknown } | undefined)?.data) as
      | { features: { geometry: { type: string } }[] }
      | undefined;
  /** The Layers tab, which is not the one showing when a filter is set from the link. */
  const layers = (r: Rendered) => r.el.querySelector<HTMLButtonElement>('#tab-layers')!.click();
  const followBox = (r: Rendered) => [...r.el.querySelectorAll<HTMLLabelElement>('fieldset label')].find((l) => l.textContent?.includes('Follow chosen units'))!.querySelector('input')!;

  it('starts off, with the track layers ready but hidden', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { units: '3233' } });
    layers(r);
    await settle(r.fixture);

    expect(followBox(r).checked).toBe(false);
    expect(r.basemaps.map.layers.has('avw-tracks-line')).toBe(true);
    expect(r.basemaps.map.addLayer.mock.calls.filter(([l]) => (l as { id: string }).id.startsWith('avw-tracks')).every(([l]) => (l as unknown as { layout: { visibility: string } }).layout.visibility === 'none')).toBe(true);
  });

  it('draws a path through the chosen unit\'s contacts when switched on, and hides it when switched off', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { units: '3233' } });
    layers(r);
    await settle(r.fixture);

    followBox(r).checked = true;
    followBox(r).dispatchEvent(new Event('change'));
    await settle(r.fixture);

    expect(trackData(r)!.features.map((f) => f.geometry.type)).toContain('Point');
    expect(r.basemaps.map.setLayoutProperty).toHaveBeenCalledWith('avw-tracks-line', 'visibility', 'visible');

    followBox(r).checked = false;
    followBox(r).dispatchEvent(new Event('change'));
    await settle(r.fixture);
    expect(trackData(r)!.features).toEqual([]);
    expect(r.basemaps.map.setLayoutProperty).toHaveBeenLastCalledWith('avw-tracks-stops', 'visibility', 'none');
  });

  it('tells the reader to choose a unit when none is chosen', async () => {
    const r = await render({ contacts: CONTACTS, inputs: { track: '1' } });

    expect(r.el.textContent).toContain('Choose a unit in the Filters tab');
  });

  it('tells the reader when too many units are chosen to follow, and draws nothing', async () => {
    const r = await render({ contacts: CONTACTS, inputs: { track: '1' } });

    (r.fixture.componentInstance as unknown as { setFilters(f: unknown): void }).setFilters({ ...NO_FILTERS, units: new Set([3310, 3259, 3234, 15838, 15839, 3233, 1]) });
    await settle(r.fixture);

    expect(r.el.textContent).toContain('too many units to follow at once');
    expect(trackData(r)!.features).toEqual([]);
  });

  it('steps through the incidents of one followed unit, opening each in turn', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { units: '3259!' }, inputs: { track: '1' } });      // unit 3259 alone: contact 2
    layers(r);
    await settle(r.fixture);
    expect(r.el.querySelector('.panel__step')?.textContent).toContain('1 incidents');

    r.el.querySelector<HTMLButtonElement>('[aria-label="Next incident"]')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(CONTACTS[1].lat, CONTACTS[1].lon, expect.anything());
  });

  it('follows the filters: the path changes as the contacts shown change', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { units: '3233' }, inputs: { track: '1' } });
    const stops = () => trackData(r)!.features.filter((f) => f.geometry.type === 'Point').length;
    const before = stops();

    timelineChart(r).zoomed.emit({ start: dayMs('1966-03-01'), end: dayMs('1966-03-04') });
    await settle(r.fixture);

    expect(before).toBeGreaterThan(stops());
  });
});
