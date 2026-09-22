import { describe, expect, it, vi } from 'vitest';
import { StubEChart } from './analytics/echart-stub';
import { dayMs } from './analytics/timeline';
import { render, settle } from './battlemap-testing';
import { CONTACTS } from './filter-fixtures';

type Rendered = Awaited<ReturnType<typeof render>>;

const DAY = 86_400_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const names = (r: Rendered) => [...r.el.querySelectorAll('app-timeline [role=option] .row__name')].map((n) => n.firstChild!.textContent);
const chart = (r: Rendered) =>
  r.fixture.debugElement.query((d) => d.name === 'app-timeline').query((d) => d.componentInstance instanceof StubEChart).componentInstance as StubEChart;
const openFilters = async (r: Rendered) => {
  r.el.querySelector<HTMLButtonElement>('#tab-filters')!.click();
  await settle(r.fixture);
};
/** The ids of the contacts the map was last asked to fit to. */
const fitted = (r: Rendered) => (r.basemaps.fitTo.mock.calls.at(-1)?.[0] as { id: number }[] | undefined)?.map((c) => c.id);

describe('the operation list and the filters', () => {
  it('lists every operation that has contacts while nothing is filtered', async () => {
    const r = await render({ contacts: CONTACTS });

    expect(names(r)).toEqual(['Hardihood, Phase 2', 'Coburg']);
  });

  it('lists only the operations that have contacts of a unit chosen in the filters', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { units: '3259!' } });         // unit 3259 alone: contact 2, in Coburg

    expect(names(r)).toEqual(['Coburg']);
  });

  it('follows the filters as they change', async () => {
    const r = await render({ contacts: CONTACTS });
    await openFilters(r);
    expect(names(r)).toEqual(['Hardihood, Phase 2', 'Coburg']);

    r.el.querySelector<HTMLInputElement>('input[name=mine][value=yes]')!.click();               // only contact 2 has a mine incident
    await settle(r.fixture);

    expect(names(r)).toEqual(['Coburg']);
  });

  it('keeps the other operations listed once one is chosen, so more can be added', async () => {
    const r = await render({ contacts: CONTACTS });

    r.el.querySelector<HTMLElement>('app-timeline [role=option]')!.click();
    await settle(r.fixture);

    expect(names(r)).toEqual(['Hardihood, Phase 2', 'Coburg']);
  });

  it('is not narrowed by the date filter, which only sets the stretch of time the list shows', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { from: '1966-03-04', to: '1966-03-31' } });

    // Coburg (5 March) runs in that stretch; Hardihood, 3 March to November 1971, runs through it.
    expect(names(r)).toEqual(['Hardihood, Phase 2', 'Coburg']);
    // The list and the bar chart below it always show the same stretch, so this is also what the chart is zoomed to.
    expect((chart(r).option() as Record<string, any>)['dataZoom'][0]).toMatchObject({ startValue: dayMs('1966-03-04'), endValue: dayMs('1966-03-31') + DAY });
  });
});

describe('an incident and the operation list', () => {
  it('zooms the list to the incident\'s operation, marking it and the date of the incident', async () => {
    const r = await render({ contacts: CONTACTS, inputs: { incident: '2' } });         // 5 March 1966, in Coburg

    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
    expect(r.el.querySelector('app-timeline .row.is-focus .row__name')!.firstChild!.textContent).toBe('Coburg');
    expect(r.el.querySelector('app-timeline .axis__marker')!.textContent).toContain('Incident 5 Mar 1966 08:10');
    expect(r.el.querySelector('app-timeline .tl__marker')).not.toBeNull();
    // The bar chart is zoomed to match, not left showing the plain (unset) date filter.
    expect((chart(r).option() as Record<string, any>)['dataZoom'][0].startValue).toBeLessThan(dayMs('1966-03-05'));
  });

  it('moves to another incident\'s operation when another is chosen', async () => {
    const r = await render({ contacts: CONTACTS, inputs: { incident: '2' } });

    r.basemaps.clickHandler!({ id: 1 });                                                // 3 March 1966, in Hardihood, Phase 2
    await settle(r.fixture);

    expect(r.el.querySelector('app-timeline .row.is-focus .row__name')!.firstChild!.textContent).toBe('Hardihood, Phase 2');
    expect(r.el.querySelector('app-timeline .axis__marker')!.textContent).toContain('Incident 3 Mar 1966');
  });

  it('closes the incident, and zooms the list back out, when empty map is clicked', async () => {
    const r = await render({ contacts: CONTACTS, inputs: { incident: '2' } });
    expect(r.el.querySelector('app-timeline .axis__marker')).not.toBeNull();

    r.basemaps.backgroundClick!();
    await settle(r.fixture);

    expect(r.el.querySelector('app-incident-panel')).toBeNull();
    expect(r.el.querySelector('app-timeline .axis__marker')).toBeNull();
    expect(r.el.querySelector('app-timeline .is-focus')).toBeNull();
    expect(r.basemaps.map.setFilter).toHaveBeenLastCalledWith('avw-contacts-selected', ['==', ['get', 'id'], -1]);
  });

  it('also closes a base or a photo that the map opened', async () => {
    const base = await render({ inputs: { poi: '1' } });
    expect(base.el.querySelector('app-poi-panel')).not.toBeNull();
    base.basemaps.backgroundClick!();
    await settle(base.fixture);
    expect(base.el.querySelector('app-poi-panel')).toBeNull();
  });

  it('does nothing when nothing is open, and is only asked about empty map', async () => {
    const r = await render({ contacts: CONTACTS });

    expect(() => r.basemaps.backgroundClick!()).not.toThrow();
    // The map binds it to the layers whose features open a panel, so a click on one of them is not "empty".
    expect(r.basemaps.bindBackgroundClick.mock.calls[0][0]).toEqual(
      expect.arrayContaining(['avw-contacts-points', 'avw-pois-points', 'avw-photos-points', 'avw-photos-clusters']),
    );
  });

  it('leaves the date filter and the contacts alone', async () => {
    const r = await render({ contacts: CONTACTS, inputs: { incident: '2' } });

    expect(r.el.querySelector('#tab-filters .badge')).toBeNull();
    expect(r.basemaps.fitTo).not.toHaveBeenCalled();
  });
});

describe('zooming the map to the contacts a filter leaves', () => {
  const chooseMine = async (r: Rendered) => {
    r.el.querySelector<HTMLInputElement>('input[name=mine][value=yes]')!.click();               // only contact 2 has a mine incident
    await settle(r.fixture);
  };

  it('zooms to the contacts left, no closer than a single incident should be, clear of the panels', async () => {
    const r = await render({ contacts: CONTACTS });
    await openFilters(r);
    expect(r.basemaps.fitTo).not.toHaveBeenCalled();

    await chooseMine(r);

    expect(r.basemaps.fitTo).toHaveBeenCalledTimes(1);
    expect(fitted(r)).toEqual([2]);
    expect(r.basemaps.fitTo.mock.calls[0][1]).toEqual({ top: 64, left: 32, bottom: expect.any(Number), right: expect.any(Number) });
    expect(r.basemaps.fitTo.mock.calls[0][2]).toBe(13);
  });

  it('zooms back out to everything when the filters are cleared', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { mine: 'yes' } });
    await openFilters(r);

    r.el.querySelector<HTMLButtonElement>('.summary__clear')!.click();
    await settle(r.fixture);

    expect(fitted(r)).toEqual([1, 2, 3, 4]);
  });

  it('zooms to the contacts of an operation chosen on the list, and back out when it is chosen off', async () => {
    const r = await render({ contacts: CONTACTS });

    r.el.querySelector<HTMLElement>('app-timeline [role=option]:last-child')!.click();        // Coburg
    await settle(r.fixture);
    expect(fitted(r)).toEqual([2]);

    r.basemaps.fitTo.mockClear();
    r.el.querySelector<HTMLElement>('app-timeline [role=option]:last-child')!.click();        // off again
    await settle(r.fixture);
    expect(fitted(r)).toEqual([1, 2, 3, 4]);
  });

  it('zooms to the dates picked on the timeline', async () => {
    const r = await render({ contacts: CONTACTS });
    const chart = r.fixture.debugElement.query((d) => d.name === 'app-timeline').query((d) => d.componentInstance instanceof StubEChart).componentInstance as StubEChart;

    chart.zoomed.emit({ start: dayMs('1966-03-01'), end: dayMs('1966-04-01') });
    await settle(r.fixture);

    expect(fitted(r)).toEqual([1, 2]);                                                    // the two March 1966 contacts
  });

  it('does not zoom when the page opens with filters in its link, which has a view of its own', async () => {
    const r = await render({ contacts: CONTACTS, queryParams: { mine: 'yes' } });

    expect(r.basemaps.fitTo).not.toHaveBeenCalled();
  });

  it('does not zoom when a filter leaves nothing to zoom to', async () => {
    const r = await render({ contacts: CONTACTS.map((c) => ({ ...c, mine: 1 })) });
    await openFilters(r);

    await chooseMine(r);                                                                  // nothing has a mine incident

    expect(r.basemaps.fitTo).not.toHaveBeenCalled();
  });

  it('waits for the answer to a report search, then zooms to the reports that match', async () => {
    const search = vi.fn(() => Promise.resolve([2]));
    const r = await render({ contacts: CONTACTS, search });
    await openFilters(r);

    const box = r.el.querySelector<HTMLInputElement>('input.text')!;
    box.value = 'claymore';
    box.dispatchEvent(new Event('input'));
    await settle(r.fixture);
    expect(r.basemaps.fitTo).not.toHaveBeenCalled();                                      // the search has not answered

    await wait(480);
    await settle(r.fixture);

    expect(search).toHaveBeenCalled();
    expect(r.basemaps.fitTo).toHaveBeenCalledTimes(1);
    expect(fitted(r)).toEqual([2]);
  });

  it('leaves the camera alone while play moves the window on', async () => {
    const r = await render({ contacts: CONTACTS });
    await openFilters(r);
    const play = [...r.el.querySelectorAll<HTMLButtonElement>('app-timeline button')].find((b) => b.textContent?.trim() === 'Play')!;

    play.click();
    await settle(r.fixture);
    await chooseMine(r);
    play.click();                                                                         // pause, so no timer is left running
    await settle(r.fixture);

    expect(r.basemaps.fitTo).not.toHaveBeenCalled();
  });
});
