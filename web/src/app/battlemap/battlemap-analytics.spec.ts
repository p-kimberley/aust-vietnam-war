import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { REFRESH_DELAY_MS } from './analytics/analytics-panel';
import { StubEChart } from './analytics/echart-stub';
import { dayMs } from './analytics/timeline';
import { contacts, render, settle } from './battlemap-testing';
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
    expect(r.el.querySelector('#tab-filters .badge')?.textContent).toBe('1');
  });

  it('follows a date range set in the filter panel, and clears it with "Reset zoom"', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { from: '1966-03-04', to: '1966-03-31' } });

    expect(r.el.querySelector('.tl__range')?.textContent).toBe('1966-03-04 to 1966-03-31');
    expect(shownIds(r)).toEqual([2]);

    button(r, 'Reset zoom').click();
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
  const stops = (r: Rendered) => trackData(r)!.features.filter((f) => f.geometry.type === 'Point').length;
  /** The small button beside the unit's name in the incident panel; the fixture incident involves unit 3, "1 Pl, A Coy". */
  const followButton = (r: Rendered) => r.el.querySelector<HTMLButtonElement>('.unit__follow')!;
  const chip = (r: Rendered) => [...r.el.querySelectorAll<HTMLButtonElement>('.bm__bar button')].find((b) => b.textContent?.includes('Following'));

  it('starts with nothing followed: the layers are ready but hidden, and the layer list has no unit switch', async () => {
    const r = await render({});

    expect(r.el.querySelector('#tabpanel')!.textContent).not.toContain('Follow chosen units');
    expect([...r.el.querySelectorAll('legend')].map((l) => l.textContent)).not.toContain('Units');
    expect(chip(r)).toBeUndefined();
    expect(r.basemaps.map.layers.has('avw-tracks-line')).toBe(true);
    expect(r.basemaps.map.addLayer.mock.calls.filter(([l]) => (l as { id: string }).id.startsWith('avw-tracks')).every(([l]) => (l as unknown as { layout: { visibility: string } }).layout.visibility === 'none')).toBe(true);
  });

  it('follows a unit from the button beside its name in the incident panel, and stops when pressed again', async () => {
    const r = await render({ inputs: { incident: '2' } });
    await settle(r.fixture);
    expect(followButton(r).getAttribute('aria-label')).toBe('Follow 1 Pl, A Coy on the map');
    expect(followButton(r).getAttribute('aria-pressed')).toBe('false');

    followButton(r).click();
    await settle(r.fixture);

    expect(stops(r)).toBe(2);                       // contacts 2 and 9 involve the unit
    expect(r.basemaps.map.setLayoutProperty).toHaveBeenCalledWith('avw-tracks-line', 'visibility', 'visible');
    expect(followButton(r).getAttribute('aria-pressed')).toBe('true');
    expect(followButton(r).getAttribute('aria-label')).toBe('Stop following 1 Pl, A Coy on the map');
    expect(chip(r)!.textContent).toContain('Following 1 unit');

    followButton(r).click();
    await settle(r.fixture);

    expect(trackData(r)!.features).toEqual([]);
    expect(r.basemaps.map.setLayoutProperty).toHaveBeenLastCalledWith('avw-tracks-stops', 'visibility', 'none');
    expect(chip(r)).toBeUndefined();
  });

  it('shows the colour of the line and the number of incidents beside a followed unit, and steps through them', async () => {
    const r = await render({ inputs: { incident: '2', follow: '3' } });
    await settle(r.fixture);

    expect(r.el.querySelector('.unit__swatch')).not.toBeNull();
    expect(r.el.querySelector('.unit__step')!.textContent).toContain('2');

    r.el.querySelector<HTMLButtonElement>('.unit__step [aria-label="Next incident"]')!.click();
    await settle(r.fixture);

    expect(r.basemaps.flyTo).toHaveBeenCalledWith(contacts[1].lat, contacts[1].lon, expect.anything());     // contact 9 follows contact 2
  });

  it('opens with the units in the link followed, and writes them back into the link', async () => {
    const r = await render({ inputs: { follow: '3' } });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    expect(stops(r)).toBe(2);
    expect(chip(r)!.textContent).toContain('Following 1 unit');

    chip(r)!.click();
    await settle(r.fixture);
    await wait(450);

    expect(stops(r)).toBe(0);
    expect(navigate.mock.calls.at(-1)![1]!.queryParams).toMatchObject({ follow: null, track: null });
  });

  it('still follows, for an older link with track=1, the units the filters chose', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { units: '3233' }, inputs: { track: '1' } });

    expect(stops(r)).toBeGreaterThan(0);
    expect(chip(r)!.textContent).toContain('Following 4 units');    // unit 3233 and the three beneath it
  });

  it('follows no more units than can be drawn, and greys out the button for another', async () => {
    const tooMany = await render({ inputs: { follow: '1,2,3,4,5,6,7' } });
    expect(chip(tooMany)).toBeUndefined();
    expect(trackData(tooMany)!.features).toEqual([]);
  });

  it('disables the button for a unit that would be a seventh', async () => {
    const r = await render({ inputs: { incident: '2', follow: '10,11,12,13,14,15' } });
    await settle(r.fixture);

    expect(followButton(r).disabled).toBe(true);
    expect(followButton(r).getAttribute('title')).toContain('Too many units');
  });

  it('follows the filters: the path changes as the contacts shown change', async () => {
    const r = await render({ inputs: { follow: '3' } });
    const before = stops(r);

    timelineChart(r).zoomed.emit({ start: dayMs('1966-03-01'), end: dayMs('1966-03-04') });
    await settle(r.fixture);

    expect(before).toBeGreaterThan(stops(r));
  });
});
