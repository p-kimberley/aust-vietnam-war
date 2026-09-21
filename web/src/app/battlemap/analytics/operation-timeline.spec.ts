import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Contact } from '../contacts';
import { stubEchartIn } from './echart-stub';
import { Timeline, ganttRows, operationSpans, windowPercent, yearTicks } from './timeline';

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
  const rows = ganttRows(operationSpans(CONTACTS, OPERATIONS), MIN, MAX);
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
});

describe('yearTicks and windowPercent', () => {
  it('marks each new year on the axis', () => {
    const ticks = yearTicks(Date.UTC(1965, 4, 1), Date.UTC(1968, 5, 1));

    expect(ticks.map((t) => t.year)).toEqual([1966, 1967, 1968]);
    expect(ticks[0].left).toBeCloseTo(((Date.UTC(1966, 0, 1) - Date.UTC(1965, 4, 1)) / (Date.UTC(1968, 5, 1) - Date.UTC(1965, 4, 1))) * 100, 6);
  });

  it('has the date filter cover a stretch of the axis, or nothing when the whole war is shown', () => {
    expect(windowPercent({ from: null, to: null }, MIN, MAX)).toBeNull();

    const band = windowPercent({ from: '1966-04-01', to: '1966-04-30' }, MIN, MAX)!;
    expect(band.left).toBeCloseTo(((Date.UTC(1966, 3, 1) - MIN) / (MAX - MIN)) * 100, 6);
    expect(band.width).toBeCloseTo((30 * DAY) / (MAX - MIN) * 100, 6);
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
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const arrow = () => el.querySelector<HTMLButtonElement>('.tl__toggle')!;
    const rows = () => [...el.querySelectorAll<HTMLElement>('[role=option]')];
    const list = () => el.querySelector<HTMLElement>('[role=listbox]')!;
    const settle = () => {
      f.detectChanges();
    };
    const press = (key: string) => {
      list().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      settle();
    };
    return { f, el, arrow, rows, list, toggled, settle, press };
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

  it('shows where the date filter sits, only while one is set', () => {
    const none = setup();
    expect(none.el.querySelector('.gantt__band')).toBeNull();

    const some = setup({ from: '1966-02-01', to: '1966-03-31' });
    expect(some.el.querySelector('.gantt__band')).not.toBeNull();
  });

  it('marks each new year on the axis', () => {
    const { el } = setup({
      all: [contact(1, '1965-06-01T00:00:00', 1), contact(2, '1967-03-01T00:00:00', 1)],
      visible: [],
    });

    expect([...el.querySelectorAll('.axis__tick')].map((t) => t.textContent!.trim())).toEqual(['1966', '1967']);
  });

  it('says so when no operation is recorded', () => {
    const { el } = setup({ operations: [] });

    expect(el.querySelector('.tl__none')!.textContent).toContain('No operations');
    expect(el.querySelector('[role=listbox]')).toBeNull();
  });
});
