import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Contact } from '../contacts';
import { StubEChart, stubEchartIn } from './echart-stub';
import { MIN_DRAG_PX, Timeline, axisTicks, dayMs, dragRange, focusWindow, ganttRows, operationSpans } from './timeline';
import type { DateRange } from './timeline';

const contact = (id: number, dtg: string, op: number): Contact => ({
  id, dtg, lat: 10, lon: 107, fr: 0, frCas: 0, en: 0, enCas: 0, frKia: 0, frWia: 0, enKia: 0, enWia: 0, units: [], op, task: 0, series: 1, mine: 0,
});

const OPERATIONS = [{ name: 'Alpha' }, { name: 'Bravo' }, { name: 'Charlie' }, { name: 'Delta' }];

const CONTACTS = [
  contact(1, '1966-01-20T10:00:00', 1),
  contact(2, '1966-01-05T10:00:00', 1),
  contact(3, '1966-04-02T10:00:00', 2),
  contact(4, '1966-02-10T10:00:00', 0),                      // no operation recorded
  contact(5, '1966-06-30T23:00:00', 2),
  contact(6, '1966-03-01T10:00:00', 9),                      // an operation the catalogue does not have
  contact(7, '1966-01-05T18:00:00', 4),
];

const MIN = Date.UTC(1966, 0, 1);
const MAX = Date.UTC(1966, 6, 1);
const DAY = 86_400_000;

describe('operationSpans', () => {
  it('runs each operation from its first contact to its last, counting its contacts', () => {
    const spans = operationSpans(CONTACTS, OPERATIONS);

    expect(spans.find((s) => s.name === 'Alpha')).toEqual({ name: 'Alpha', start: Date.UTC(1966, 0, 5), end: Date.UTC(1966, 0, 20), count: 2 });
    expect(spans.find((s) => s.name === 'Bravo')).toEqual({ name: 'Bravo', start: Date.UTC(1966, 3, 2), end: Date.UTC(1966, 5, 30), count: 2 });
  });

  it('leaves out contacts with no operation, an unknown one, and operations that have no contacts', () => {
    const names = operationSpans(CONTACTS, OPERATIONS).map((s) => s.name);

    expect(names).not.toContain('Charlie');
    expect(names).toHaveLength(3);
  });

  it('puts the earliest first, the longer first when two start together, then by name', () => {
    const names = operationSpans([contact(1, '1966-02-01T00:00:00', 2), contact(2, '1966-02-01T00:00:00', 1), contact(3, '1966-02-09T00:00:00', 1)], OPERATIONS).map((s) => s.name);

    expect(names).toEqual(['Alpha', 'Bravo']);              // both start on 1 February; Alpha runs longer
    expect(operationSpans(CONTACTS, OPERATIONS).map((s) => s.name)).toEqual(['Alpha', 'Delta', 'Bravo']);
  });
});

describe('ganttRows', () => {
  const spans = operationSpans(CONTACTS, OPERATIONS);
  const rows = ganttRows(spans, MIN, MAX);
  const alpha = rows.find((r) => r.name === 'Alpha')!;

  it('places a bar in percent of the axis, counting the last day in full', () => {
    const total = MAX - MIN;
    expect(alpha.left).toBeCloseTo(((Date.UTC(1966, 0, 5) - MIN) / total) * 100, 6);
    expect(alpha.width).toBeCloseTo(((Date.UTC(1966, 0, 20) + DAY - Date.UTC(1966, 0, 5)) / total) * 100, 6);
  });

  it('keeps a one-day operation wide enough to see, and inside the axis', () => {
    const delta = rows.find((r) => r.name === 'Delta')!;

    expect(delta.width).toBeGreaterThanOrEqual(0.35);
    expect(delta.left + delta.width).toBeLessThanOrEqual(100);
    expect(rows.every((r) => r.left >= 0 && r.left + r.width <= 100.0001)).toBe(true);
  });

  it('describes the dates in words', () => {
    expect(alpha.dates).toBe('1966-01-05 to 1966-01-20');
    expect(rows.find((r) => r.name === 'Delta')!.dates).toBe('1966-01-05');
  });

  it('lists only the operations that overlap the stretch of time shown, and cuts a bar that runs past its edge', () => {
    const zoomed = ganttRows(spans, Date.UTC(1966, 0, 10), Date.UTC(1966, 0, 15));

    expect(zoomed.map((r) => r.name)).toEqual(['Alpha']);
    expect(zoomed[0].left).toBe(0);
    expect(zoomed[0].width).toBeCloseTo(100, 6);              // Alpha runs the whole of that stretch
    expect(zoomed[0].dates).toBe('1966-01-05 to 1966-01-20');  // the words still give the whole operation
  });

  it('counts a bar that ends the day the stretch starts, and one that begins the day it ends, as outside it', () => {
    const edge = ganttRows(spans, Date.UTC(1966, 0, 21), Date.UTC(1966, 3, 2));

    expect(edge.map((r) => r.name)).toEqual([]);
  });
});

describe('axisTicks', () => {
  const inOrder = (ticks: { left: number }[]) => ticks.every((t, i) => t.left >= 0 && t.left <= 100 && (i === 0 || t.left > ticks[i - 1].left));

  it('labels the years across the whole war', () => {
    const ticks = axisTicks(Date.UTC(1965, 4, 1), Date.UTC(1969, 5, 1));

    expect(ticks.map((t) => t.label)).toEqual(['1966', '1967', '1968', '1969']);
    expect(ticks[0].left).toBeCloseTo(((Date.UTC(1966, 0, 1) - Date.UTC(1965, 4, 1)) / (Date.UTC(1969, 5, 1) - Date.UTC(1965, 4, 1))) * 100, 6);
  });

  it('labels months for a year or two, and days when zoomed close, never more than a dozen or so', () => {
    const months = axisTicks(Date.UTC(1966, 0, 1), Date.UTC(1967, 0, 1));
    expect(months.map((t) => t.label).slice(0, 3)).toEqual(['Feb 1966', 'Mar 1966', 'Apr 1966']);

    const days = axisTicks(Date.UTC(1966, 2, 1), Date.UTC(1966, 2, 21));
    expect(days.every((t) => /^\d{1,2} Mar$/.test(t.label))).toBe(true);

    for (const [a, b] of [[MIN, MAX], [Date.UTC(1966, 0, 1), Date.UTC(1968, 0, 1)], [Date.UTC(1966, 2, 1), Date.UTC(1966, 2, 6)], [MIN, MIN + 100 * DAY]]) {
      const ticks = axisTicks(a, b);
      expect(ticks.length).toBeLessThanOrEqual(14);
      expect(inOrder(ticks)).toBe(true);
    }
  });
});

describe('focusWindow', () => {
  const spans = operationSpans(CONTACTS, OPERATIONS);

  it('shows an incident\'s operation from its first contact to its last, with a margin at each end', () => {
    const wide = Date.UTC(1966, 11, 1);
    const w = focusWindow({ date: '1966-04-15T09:00:00', operation: 'Bravo' }, spans, MIN, wide);

    expect(w.start).toBeLessThan(Date.UTC(1966, 3, 2));
    expect(w.end).toBeGreaterThan(Date.UTC(1966, 5, 30) + DAY);
  });

  it('shows a couple of months round an incident that has no operation', () => {
    const w = focusWindow({ date: '1966-03-10T09:00:00', operation: null }, spans, MIN, MAX);

    expect(w.start).toBeLessThan(Date.UTC(1966, 2, 10) - 30 * DAY + 1);
    expect(w.end).toBeGreaterThan(Date.UTC(1966, 2, 10) + 30 * DAY);
  });

  it('never goes past the ends of the timeline, or narrower than a couple of weeks', () => {
    const early = focusWindow({ date: '1966-01-01T00:00:00', operation: null }, spans, MIN, MAX);
    expect(early.start).toBe(MIN);
    const late = focusWindow({ date: '1966-06-30T00:00:00', operation: null }, spans, MIN, MAX);
    expect(late.end).toBe(MAX);
    expect(late.end - late.start).toBe(early.end - early.start);      // slid inward, not cut

    const oneDay = focusWindow({ date: '1966-01-05T18:00:00', operation: 'Delta' }, spans, MIN, MAX);
    expect(oneDay.end - oneDay.start).toBeGreaterThanOrEqual(13 * DAY);
  });

  it('copes with an operation that is not listed', () => {
    const w = focusWindow({ date: '1966-02-10T09:00:00', operation: 'Nowhere' }, spans, MIN, MAX);

    expect(w.end).toBeGreaterThan(w.start);
  });
});

describe('dragRange', () => {
  const extent = { start: MIN, end: MAX };

  it('turns a drag across the bars into whole days, the plot area being inside the chart margins', () => {
    const whole = dragRange(8, 988, 1000, extent)!;
    expect(whole).toEqual({ start: MIN, end: MAX });

    const half = dragRange(8, 498, 1000, extent)!;
    expect(half.start).toBe(MIN);
    expect(Math.abs(half.end % DAY)).toBe(0);
    expect(half.end).toBe(MIN + 91 * DAY);
  });

  it('does not mind which way the pointer went, and stays inside the bars', () => {
    expect(dragRange(498, 8, 1000, extent)).toEqual(dragRange(8, 498, 1000, extent));
    expect(dragRange(-50, 5000, 1000, extent)).toEqual({ start: MIN, end: MAX });
  });

  it('gives at least a day, and nothing where the chart has no width', () => {
    const tiny = dragRange(300, 300, 1000, extent)!;
    expect(tiny.end - tiny.start).toBe(DAY);
    expect(dragRange(0, 10, 15, extent)).toBeNull();
  });
});

describe('Timeline operations', () => {
  function setup(inputs: Record<string, unknown> = {}) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    stubEchartIn(Timeline);
    const f: ComponentFixture<Timeline> = TestBed.createComponent(Timeline);
    const all: Record<string, unknown> = { all: CONTACTS, visible: CONTACTS, operations: OPERATIONS, ...inputs };
    for (const [k, v] of Object.entries(all)) {
      f.componentRef.setInput(k, v);
    }
    const toggled = vi.fn();
    f.componentInstance.operationToggled.subscribe(toggled);
    const ranges: DateRange[] = [];
    f.componentInstance.rangeChange.subscribe((r) => ranges.push(r));
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const arrow = () => el.querySelector<HTMLButtonElement>('.tl__toggle')!;
    const rows = () => [...el.querySelectorAll<HTMLElement>('[role=option]')];
    const list = () => el.querySelector<HTMLElement>('[role=listbox]')!;
    const chart = () => f.debugElement.query((d) => d.componentInstance instanceof StubEChart).componentInstance as StubEChart;
    const settle = () => {
      f.detectChanges();
    };
    const press = (key: string) => {
      list().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      settle();
    };
    return { f, el, arrow, rows, list, chart, toggled, ranges, settle, press };
  }

  const text = (e: Element) => e.querySelector('.row__name')!.firstChild!.textContent;

  it('has an arrow at the centre of its top edge that opens and closes the operation timeline', () => {
    const { f, el, arrow, settle } = setup();
    const region = () => el.querySelector('.tl__ops')!;

    expect(arrow().getAttribute('aria-expanded')).toBe('false');
    expect(arrow().getAttribute('aria-label')).toBe('Show the operation timeline');
    expect(arrow().getAttribute('aria-controls')).toBe(region().id);
    expect(region().classList.contains('is-open')).toBe(false);

    arrow().click();
    settle();
    expect(f.componentInstance.expanded()).toBe(true);
    expect(arrow().getAttribute('aria-expanded')).toBe('true');
    expect(arrow().getAttribute('aria-label')).toBe('Hide the operation timeline');
    expect(region().classList.contains('is-open')).toBe(true);

    arrow().click();
    settle();
    expect(f.componentInstance.expanded()).toBe(false);
  });

  it('starts open when it is told to', () => {
    const { el } = setup({ expanded: true });
    expect(el.querySelector('.tl__ops')!.classList.contains('is-open')).toBe(true);
  });

  it('lists the operations that have contacts, earliest first, each with its bar and its dates', () => {
    const { rows } = setup();

    expect(rows().map(text)).toEqual(['Alpha', 'Delta', 'Bravo']);
    expect(rows().every((r) => r.querySelector('.row__bar') !== null)).toBe(true);
    expect(rows()[0].getAttribute('title')).toBe('Alpha: 1966-01-05 to 1966-01-20 (2 contacts)');
    expect(rows()[1].getAttribute('title')).toBe('Delta: 1966-01-05 (1 contact)');
    expect(rows()[0].textContent).toContain('1966-01-05 to 1966-01-20');     // for a screen reader
  });

  it('marks the operations chosen as a filter, any number of them', () => {
    const { rows } = setup({ selectedOperations: new Set(['Alpha', 'Bravo']) });

    expect(rows().map((r) => r.getAttribute('aria-selected'))).toEqual(['true', 'false', 'true']);
    expect(rows().map((r) => r.classList.contains('is-on'))).toEqual([true, false, true]);
  });

  it('says a click on an operation is to choose it, and the same click takes it off again', () => {
    const { rows, toggled, settle } = setup();

    rows()[2].click();
    settle();
    expect(toggled).toHaveBeenLastCalledWith('Bravo');

    rows()[2].click();
    expect(toggled).toHaveBeenCalledTimes(2);
    expect(toggled).toHaveBeenLastCalledWith('Bravo');
  });

  it('works from the keyboard: arrows, Home and End move, Space or Enter chooses', () => {
    const { list, rows, press, toggled } = setup();
    const active = () => list().getAttribute('aria-activedescendant');

    expect(active()).toBe(rows()[0].id);
    press('ArrowDown');
    expect(active()).toBe(rows()[1].id);
    press('End');
    expect(active()).toBe(rows()[2].id);
    press('ArrowDown');                                   // stays at the end
    expect(active()).toBe(rows()[2].id);
    press('Home');
    press('ArrowUp');                                     // stays at the start
    expect(active()).toBe(rows()[0].id);

    press('ArrowDown');
    press(' ');
    expect(toggled).toHaveBeenLastCalledWith('Delta');
    press('Enter');
    expect(toggled).toHaveBeenCalledTimes(2);
    expect(rows()[1].classList.contains('is-active')).toBe(true);
  });

  it('says so when no operation is recorded, or none matches', () => {
    expect(setup({ operations: [] }).el.querySelector('.tl__none')!.textContent).toContain('No operations are recorded');

    const none = setup({ scope: [] });
    expect(none.el.querySelector('.tl__none')!.textContent).toContain('No operation has contacts that match');
    expect(none.el.querySelector('[role=listbox]')).toBeNull();
  });

  describe('the filters', () => {
    it('list only the operations that have contacts among those the filters leave', () => {
      const { rows } = setup({ scope: CONTACTS.filter((c) => c.op === 2) });

      expect(rows().map(text)).toEqual(['Bravo']);
    });

    it('draw a bar for the contacts left, so a unit\'s bar runs only over the time it was in the operation', () => {
      const { rows } = setup({ scope: [CONTACTS[0], CONTACTS[2]] });         // one Alpha contact (20 Jan), one Bravo (2 Apr)

      expect(rows().map((r) => r.getAttribute('title'))).toEqual(['Alpha: 1966-01-20 (1 contact)', 'Bravo: 1966-04-02 (1 contact)']);
    });
  });

  describe('the date extents', () => {
    it('are the stretch of time the list shows, so it lists just the operations running in it', () => {
      const { rows } = setup({ from: '1966-04-01', to: '1966-06-30' });

      expect(rows().map(text)).toEqual(['Bravo']);
    });

    it('shows date labels only on the bar chart below, not said again above the operations', () => {
      const { el } = setup();

      expect(el.querySelectorAll('.axis__tick')).toHaveLength(0);
      expect(el.querySelectorAll('.gantt__grid').length).toBeGreaterThan(0);      // the grid lines that line up with the labels are still there
    });

    it('always shows the same stretch of time as the bar chart below it', () => {
      const { chart } = setup({ from: '1966-03-01', to: '1966-03-20' });

      expect((chart().option() as Record<string, any>)['dataZoom'][0]).toMatchObject({ startValue: dayMs('1966-03-01'), endValue: dayMs('1966-03-20') + DAY });
    });

    it('offer "Reset zoom" only when the dates are narrowed, which goes back to the whole war', () => {
      const whole = setup();
      expect(whole.el.textContent).not.toContain('Reset zoom');
      expect(whole.el.textContent).toContain('Drag across the bars to zoom');

      const narrowed = setup({ from: '1966-03-01' });
      const button = [...narrowed.el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Reset zoom')!;
      button.click();
      expect(narrowed.ranges).toEqual([{ from: null, to: null }]);
    });
  });

  describe('an open incident', () => {
    const focus = { date: '1966-04-15T09:30:00', operation: 'Bravo' };

    it('zooms the list to its operation, and marks the operation', () => {
      const { rows } = setup({ focus });

      expect(rows().map(text)).toEqual(['Bravo']);               // the dates shown are those of Bravo, so the others are out of them
      expect(rows()[0].classList.contains('is-focus')).toBe(true);
    });

    it('marks the date of the incident on the axis, and with a red line the full height of the timeline', () => {
      const { el } = setup({ focus });

      expect(el.querySelector('.axis__marker')!.textContent).toContain('Incident 15 Apr 1966 09:30');
      const marker = el.querySelector('.tl__marker')!;
      expect(marker).not.toBeNull();
      // Outside the scrollable operation list, so the line reaches into the bar chart below it too, not just the rows.
      expect(el.querySelector('.tl__ops')!.contains(marker)).toBe(false);
    });

    it('always shows the same stretch of time as the bar chart below it, zoomed to the incident\'s operation', () => {
      const spans = operationSpans(CONTACTS, OPERATIONS);
      const expected = focusWindow(focus, spans, MIN, MAX);

      const { chart } = setup({ focus });

      expect((chart().option() as Record<string, any>)['dataZoom'][0]).toMatchObject({ startValue: expected.start, endValue: expected.end });
    });

    it('does not change the date filter, and goes back to the dates when it is closed', () => {
      const { f, rows, el, ranges, settle } = setup({ focus });
      expect(ranges).toEqual([]);

      f.componentRef.setInput('focus', null);
      settle();

      expect(rows().map(text)).toEqual(['Alpha', 'Delta', 'Bravo']);
      expect(el.querySelector('.axis__marker')).toBeNull();
      expect(el.querySelector('.tl__marker')).toBeNull();
      expect(el.querySelector('.is-focus')).toBeNull();
    });

    it('zooms round the date when the incident has no operation, marking no row', () => {
      const { rows, el } = setup({ focus: { date: '1966-01-10T00:00:00', operation: null } });

      expect(rows().map(text)).toEqual(['Alpha', 'Delta']);
      expect(el.querySelector('.is-focus')).toBeNull();
      expect(el.querySelector('.axis__marker')).not.toBeNull();
    });

    it('starts the keyboard on the incident\'s operation', () => {
      const { list, rows } = setup({ focus: { date: '1966-01-10T00:00:00', operation: 'Delta' } });

      expect(list().getAttribute('aria-activedescendant')).toBe(rows().find((r) => text(r) === 'Delta')!.id);
    });

    it('can still be chosen as a filter like any other', () => {
      const { rows, toggled } = setup({ focus });

      rows()[0].click();

      expect(toggled).toHaveBeenCalledWith('Bravo');
    });
  });

  describe('dragging across the bars', () => {
    function drag(s: ReturnType<typeof setup>, from: number, to: number, y = 50) {
      const chart = s.el.querySelector<HTMLElement>('.tl__chart')!;
      vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 200, width: 1000, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
      const fire = (type: string, x: number, at = y) => chart.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: at, button: 0, bubbles: true }));
      fire('pointerdown', from);
      fire('pointermove', to);
      s.settle();
      const boxWhileDragging = s.el.querySelector<HTMLElement>('.tl__drag');
      fire('pointerup', to);
      s.settle();
      return { boxWhileDragging };
    }

    it('sets the dates to those it spans, and shows the stretch being picked while it goes', () => {
      const s = setup();

      const { boxWhileDragging } = drag(s, 8, 498);

      expect(boxWhileDragging).not.toBeNull();
      expect(boxWhileDragging!.style.left).toBe('8px');
      expect(boxWhileDragging!.style.width).toBe('490px');
      expect(s.ranges).toEqual([{ from: null, to: '1966-04-01' }]);
      expect(s.el.querySelector('.tl__drag')).toBeNull();
    });

    it('picks dates from the stretch the chart shows now, not the whole war', () => {
      const s = setup({ from: '1966-04-01', to: '1966-04-30' });          // the chart shows April

      drag(s, 8, 988);

      expect(s.ranges).toEqual([{ from: '1966-04-01', to: '1966-04-30' }]);
    });

    it('ignores a drag that is too short to mean it, and one that starts on the slider below the bars', () => {
      const s = setup();

      drag(s, 300, 300 + MIN_DRAG_PX - 1);
      drag(s, 100, 600, 190);

      expect(s.ranges).toEqual([]);
    });

    it('stops play, since the reader has taken over', () => {
      const s = setup();
      s.f.componentInstance.playing.set(true);

      drag(s, 8, 498);

      expect(s.f.componentInstance.playing()).toBe(false);
    });
  });
});
