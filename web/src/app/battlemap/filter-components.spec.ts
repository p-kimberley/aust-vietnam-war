import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ChecklistFilter } from './checklist-filter';
import { CATALOGUE, CONTACTS, UNIT_NODES } from './filter-fixtures';
import { FiltersPanel, TextStatus } from './filters-panel';
import { FilterState, NO_FILTERS } from './filters';
import { RangeFilter } from './range-filter';
import { UnitTree } from './unit-tree';
import { UnitTreeView } from './unit-tree-view';

const tree = new UnitTree(UNIT_NODES);
const counts = tree.countContacts(CONTACTS);

function create<T>(type: new () => T, inputs: Record<string, unknown>): { fixture: ComponentFixture<T>; el: HTMLElement } {
  // Some tests create more than one component, so each starts from a fresh test module.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(type);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const texts = (el: HTMLElement, selector: string) => [...el.querySelectorAll(selector)].map((e) => e.textContent?.trim());

function type(input: HTMLInputElement, value: string, event = 'input') {
  input.value = value;
  input.dispatchEvent(new Event(event, { bubbles: true }));
}

describe('UnitTreeView', () => {
  function tv(selected: ReadonlySet<number> = new Set()) {
    const { fixture, el } = create(UnitTreeView, { tree, selected, counts });
    const toggled: number[] = [];
    fixture.componentInstance.toggled.subscribe((id) => toggled.push(id));
    return { fixture, el, toggled };
  }

  it('shows the top-level units first, with how many contacts each has', () => {
    const { el } = tv();

    expect(texts(el, '.node__text')).toEqual(['1 RAR', 'US Army']);
    expect(texts(el, '.node__count')).toEqual(['2', '1']);
  });

  it('expands and collapses a unit to show its subordinates', () => {
    const { fixture, el } = tv();

    el.querySelector<HTMLButtonElement>('.node__toggle')!.click();
    fixture.detectChanges();
    expect(texts(el, '.node__text')).toEqual(['1 RAR', 'A Coy', 'D Coy', 'US Army']);
    expect(el.querySelector('.node__toggle')!.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('.node__toggle')!.getAttribute('aria-label')).toBe('Collapse 1 RAR');

    el.querySelector<HTMLButtonElement>('.node__toggle')!.click();
    fixture.detectChanges();
    expect(texts(el, '.node__text')).toEqual(['1 RAR', 'US Army']);
  });

  it('reports the unit that was ticked', () => {
    const { el, toggled } = tv();

    el.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();

    expect(toggled).toEqual([3233]);
  });

  it('shows ticked, mixed and empty states', () => {
    const { el } = tv(new Set([3310]));                                   // one platoon under 1 RAR

    const boxes = [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    expect(boxes.map((b) => [b.checked, b.indeterminate])).toEqual([
      [false, true],                                                        // 1 RAR: some
      [false, true],                                                        // A Coy: some
      [true, false],                                                        // 1 Pl: all
      [false, false],                                                       // D Coy: none
      [false, false],                                                       // US Army
    ]);
  });

  it('opens the path to what is already selected, for example from a link', () => {
    const { el } = tv(new Set([3310]));

    expect(texts(el, '.node__text')).toEqual(['1 RAR', 'A Coy', '1 Pl', 'D Coy', 'US Army']);
  });

  it('narrows to matching units, keeping the way to each, and says when nothing matches', () => {
    const { fixture, el } = tv();
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;

    type(search, 'armor');
    fixture.detectChanges();
    expect(texts(el, '.node__text')).toEqual(['US Army', '16 Armor Battalion', 'D Coy']);   // E Coy has no contacts, so stays out even here

    type(search, 'zzz');
    fixture.detectChanges();
    expect(el.querySelector('.tree__none')?.textContent).toContain('No units match');
    expect(el.querySelectorAll('.node').length).toBe(0);

    type(search, '');
    fixture.detectChanges();
    expect(texts(el, '.node__text')).toEqual(['1 RAR', 'US Army']);
  });

  it('gives each unit its full name as a tooltip', () => {
    const { el } = tv();
    expect(el.querySelector('.node__label')!.getAttribute('title')).toBe('1 Battalion, Royal Australian Regiment');
  });

  it('leaves out a unit a filter has left with no contacts, but keeps one that is already chosen', () => {
    const zeroed = new Map(counts);
    zeroed.set(3234, 0);                                                    // D Coy: a filter has left it with nothing

    const { fixture, el } = create(UnitTreeView, { tree, selected: new Set(), counts: zeroed });
    el.querySelector<HTMLButtonElement>('.node__toggle')!.click();
    fixture.detectChanges();
    expect(texts(el, '.node__text')).toEqual(['1 RAR', 'A Coy', 'US Army']);        // D Coy is left out

    // Selecting D Coy opens the path to it automatically (see "opens the path to what is already selected" above).
    const withSelection = create(UnitTreeView, { tree, selected: new Set([3234]), counts: zeroed });
    expect(texts(withSelection.el, '.node__text')).toEqual(['1 RAR', 'A Coy', 'D Coy', 'US Army']);  // shown so it can be cleared
  });
});

describe('RangeFilter', () => {
  function rf(value: [number, number] | null = null) {
    const { fixture, el } = create(RangeFilter, { label: 'Friendly strength', bounds: { min: 0, max: 700 }, value });
    const emitted: unknown[] = [];
    fixture.componentInstance.changed.subscribe((v) => emitted.push(v));
    const from = el.querySelector<HTMLInputElement>('input[aria-label="Friendly strength from"]')!;
    const to = el.querySelector<HTMLInputElement>('input[aria-label="Friendly strength to"]')!;
    return { el, from, to, emitted };
  }

  it('shows the whole extent when off, and the chosen range when on', () => {
    expect(rf().from.value).toBe('0');
    expect(rf().to.value).toBe('700');
    const on = rf([30, 500]);
    expect([on.from.value, on.to.value]).toEqual(['30', '500']);
  });

  it('emits the new range when a value is typed', () => {
    const { from, to, emitted } = rf();

    type(from, '30', 'change');
    type(to, '500', 'change');

    expect(emitted).toEqual([[30, 700], [0, 500]]);                         // each field is applied to the current value
  });

  it('clamps to the data and puts reversed values in order', () => {
    const { from, to, emitted } = rf([100, 200]);

    type(from, '-50', 'change');
    type(to, '99999', 'change');
    type(from, '300', 'change');                                            // above the current top of 200

    expect(emitted).toEqual([[0, 200], [100, 700], [200, 300]]);
  });

  it('reports no filter when the range covers everything, or when a field is emptied', () => {
    const { from, emitted } = rf([30, 700]);

    type(from, '0', 'change');
    type(from, '', 'change');

    expect(emitted).toEqual([null, null]);
  });
});

describe('ChecklistFilter', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ name: `Operation ${i + 1}`, count: i + 1 }));

  function cl(selected: ReadonlySet<string> = new Set(), list = items, extra: Record<string, unknown> = {}) {
    const { fixture, el } = create(ChecklistFilter, { label: 'Operations', items: list, selected, ...extra });
    const emitted: ReadonlySet<string>[] = [];
    fixture.componentInstance.changed.subscribe((v) => emitted.push(v));
    return { fixture, el, emitted };
  }

  it('lists every choice with its count and reflects the selection', () => {
    const { el } = cl(new Set(['Operation 2']));

    expect(texts(el, '.list__text').slice(0, 3)).toEqual(['Operation 1', 'Operation 2', 'Operation 3']);
    expect(texts(el, '.list__count').slice(0, 3)).toEqual(['1', '2', '3']);
    expect([...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map((b) => b.checked).slice(0, 3)).toEqual([false, true, false]);
  });

  it('emits the new selection without changing the one it was given', () => {
    const selected = new Set(['Operation 2']);
    const { el, emitted } = cl(selected);
    const boxes = el.querySelectorAll<HTMLInputElement>('input[type=checkbox]');

    boxes[0].click();
    boxes[1].click();

    expect(emitted.map((s) => [...s])).toEqual([['Operation 2', 'Operation 1'], []]);
    expect([...selected]).toEqual(['Operation 2']);
  });

  it('adds a search box for long lists only, and filters as you type', () => {
    const long = cl();
    expect(long.el.querySelector('input[type=search]')).not.toBeNull();

    type(long.el.querySelector<HTMLInputElement>('input[type=search]')!, 'operation 1', 'input');
    long.fixture.detectChanges();
    expect(texts(long.el, '.list__text')).toEqual(['Operation 1', 'Operation 10', 'Operation 11', 'Operation 12']);

    expect(cl(new Set(), items.slice(0, 3)).el.querySelector('input[type=search]')).toBeNull();
  });

  it('leaves out a choice that would now leave no contacts, but keeps one that is already chosen', () => {
    const zeroed = [{ name: 'Coburg', count: 0 }, { name: 'Hardihood, Phase 2', count: 2 }];
    expect(texts(cl(new Set(), zeroed).el, '.list__text')).toEqual(['Hardihood, Phase 2']);

    // Chosen earlier, then a filter (say, a date range) left it with nothing: still shown, so it can still be cleared.
    expect(texts(cl(new Set(['Coburg']), zeroed).el, '.list__text')).toEqual(['Coburg', 'Hardihood, Phase 2']);
  });

  it('says so when nothing matches', () => {
    const { fixture, el } = cl();
    type(el.querySelector<HTMLInputElement>('input[type=search]')!, 'zzz', 'input');
    fixture.detectChanges();

    expect(el.querySelector('.list__none')?.textContent).toContain('Nothing matches');
  });

  it('can show a friendlier name than the recorded one, and searches both', () => {
    const { fixture, el } = cl(new Set(), [{ name: '1ATF', count: 5 }, { name: '1RAR', count: 2 }], {
      display: (n: string) => (n === '1ATF' ? '1st Australian Task Force' : n),
      searchAbove: 0,
    });

    expect(texts(el, '.list__text')).toEqual(['1st Australian Task Force', '1RAR']);
    type(el.querySelector<HTMLInputElement>('input[type=search]')!, 'australian', 'input');
    fixture.detectChanges();
    expect(texts(el, '.list__text')).toEqual(['1st Australian Task Force']);
  });
});

describe('FiltersPanel', () => {
  // Matches CATALOGUE's own counts, as a real caller's scoped counts would with no filter yet narrowing anything.
  const namedCounts = (items: readonly { name: string; count: number }[]) => new Map(items.map((i) => [i.name, i.count]));

  function fp(state: FilterState = NO_FILTERS, extra: Record<string, unknown> = {}) {
    const { fixture, el } = create(FiltersPanel, {
      state, catalogue: CATALOGUE, tree, unitCounts: counts,
      operationCounts: namedCounts(CATALOGUE.operations), taskCounts: namedCounts(CATALOGUE.tasks), seriesCounts: namedCounts(CATALOGUE.series),
      shown: 4, total: 4, ...extra,
    });
    const emitted: FilterState[] = [];
    fixture.componentInstance.changed.subscribe((s) => emitted.push(s));
    return { fixture, el, emitted };
  }

  it('says how many contacts pass the filters', () => {
    const { el } = fp(NO_FILTERS, { shown: 2, total: 4 });
    expect(el.querySelector('.summary__count')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('2 of 4 contacts');
  });

  it('shows nothing to clear until a filter is active', () => {
    const { el } = fp();
    expect(el.querySelector('.chips')).toBeNull();
    expect(el.querySelector('.summary__clear')).toBeNull();
  });

  it('shows each active filter as a chip that removes just that filter', () => {
    const state: FilterState = { ...NO_FILTERS, mine: 'yes', hours: [6, 18], operations: new Set(['Coburg']) };
    const { el, emitted } = fp(state);

    expect(texts(el, '.chip').map((t) => t!.replace(/\s+/g, ' '))).toEqual(['Hours 06–18 ×', 'Operation: Coburg ×', 'Mine incident: yes ×']);

    el.querySelectorAll<HTMLButtonElement>('.chip')[1].click();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].operations.size).toBe(0);
    expect(emitted[0].mine).toBe('yes');                                    // the others stay
    expect(emitted[0].hours).toEqual([6, 18]);
  });

  it('labels the remove buttons for screen readers', () => {
    const { el } = fp({ ...NO_FILTERS, mine: 'no' });
    expect(el.querySelector('.chip')!.getAttribute('aria-label')).toBe('Remove filter: Mine incident: no');
  });

  it('clears everything at once', () => {
    const { el, emitted } = fp({ ...NO_FILTERS, mine: 'yes', text: 'ambush' });

    el.querySelector<HTMLButtonElement>('.summary__clear')!.click();

    expect(emitted).toEqual([NO_FILTERS]);
  });

  const operationCounts = (el: HTMLElement) => {
    const head = [...el.querySelectorAll<HTMLButtonElement>('app-accordion-section .toggle')][2];    // Operation
    const body = el.querySelector<HTMLElement>('#' + head.getAttribute('aria-controls'))!;
    return [...body.querySelectorAll('.list__count')].map((c) => c.textContent);
  };

  it('shows operation, task and source counts as scoped by the caller, not the catalogue’s own whole-dataset counts', () => {
    const { el } = fp(NO_FILTERS, { operationCounts: new Map([['Coburg', 1], ['Hardihood, Phase 2', 1]]) });

    expect(operationCounts(el)).toEqual(['1', '1']);   // both down from the catalogue's own 1 and 2, as the scoped counts say
  });

  it('leaves out a name the scoped counts left with nothing, rather than showing it at zero', () => {
    const { el } = fp(NO_FILTERS, { operationCounts: new Map([['Coburg', 1]]) });

    expect(operationCounts(el)).toEqual(['1']);   // "Hardihood, Phase 2" is not currently reachable, so it is left out entirely
  });

  it('sets a date limit, and treats the ends of the data as no limit', () => {
    const { el, emitted } = fp();
    const [from, to] = [...el.querySelectorAll<HTMLInputElement>('input[type=date]')];

    expect([from.value, to.value]).toEqual(['1966-03-03', '1971-11-02']);   // the whole extent when nothing is set
    type(from, '1968-01-01', 'change');
    type(to, '1971-11-02', 'change');
    type(from, '', 'change');

    expect(emitted.map((s) => [s.from, s.to])).toEqual([['1968-01-01', null], [null, null], [null, null]]);
  });

  it('sets the hour range', () => {
    const { el, emitted } = fp();

    type(el.querySelector<HTMLInputElement>('input[aria-label="Hour of day from"]')!, '6', 'change');

    expect(emitted[0].hours).toEqual([6, 23]);
  });

  it('sets a strength range from the catalogue bounds', () => {
    const { el, emitted } = fp();

    type(el.querySelector<HTMLInputElement>('input[aria-label="Friendly casualties to"]')!, '5', 'change');

    expect(emitted[0].frCas).toEqual([0, 5]);
  });

  it('selects a whole unit and everything beneath it', () => {
    const { el, emitted } = fp();

    el.querySelector<HTMLInputElement>('app-unit-tree input[type=checkbox]')!.click();

    expect([...emitted[0].units].sort()).toEqual([3233, 3234, 3259, 3310]);
  });

  it('chooses operations, tasks and data sources', () => {
    const { el, emitted } = fp();
    const lists = [...el.querySelectorAll('app-checklist-filter')];

    lists[0].querySelector<HTMLInputElement>('input[type=checkbox]')!.click();     // operations: Coburg
    lists[1].querySelector<HTMLInputElement>('input[type=checkbox]')!.click();     // tasks: Ambush
    lists[2].querySelector<HTMLInputElement>('input[type=checkbox]')!.click();     // data sources: 1ATF

    expect([...emitted[0].operations]).toEqual(['Coburg']);
    expect([...emitted[1].tasks]).toEqual(['Ambush']);
    expect([...emitted[2].series]).toEqual(['1ATF']);
    expect(texts(lists[2] as HTMLElement, '.list__text')).toEqual(['1st Australian Task Force', '1 RAR Battalion Group']);
  });

  it('chooses mine incident yes, no or any', () => {
    const { el, emitted } = fp();

    el.querySelector<HTMLInputElement>('input[name=mine][value=yes]')!.click();
    el.querySelector<HTMLInputElement>('input[name=mine][value=no]')!.click();

    expect(emitted.map((s) => s.mine)).toEqual(['yes', 'no']);
  });

  it('sends the report search text as typed and explains its status', () => {
    const { fixture, el, emitted } = fp();
    const box = el.querySelector<HTMLInputElement>('input.text')!;

    type(box, 'claymore');
    expect(emitted[0].text).toBe('claymore');

    const hint = () => el.querySelector('.hint[role=status]')!.textContent!.replace(/\s+/g, ' ').trim();
    const cases: [TextStatus, string][] = [
      ['idle', 'Type at least 2 letters. Every word must appear.'],
      ['searching', 'Searching…'],
      ['ready', 'Every word must appear in the report.'],
      ['error', 'The search failed. Try again in a moment.'],
    ];
    for (const [status, expected] of cases) {
      fixture.componentRef.setInput('textStatus', status);
      fixture.detectChanges();
      expect(hint()).toBe(expected);
    }
  });

  describe('accordion', () => {
    const heads = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('app-accordion-section .toggle')];
    const open = (el: HTMLElement) => heads(el).filter((h) => h.getAttribute('aria-expanded') === 'true').map((h) => h.textContent!.replace(/\s+/g, ' ').trim());
    const press = (fixture: { detectChanges(): void }, button: HTMLButtonElement) => {
      button.click();
      fixture.detectChanges();
    };

    it('starts with every section closed', () => {
      const { el } = fp();
      expect(heads(el)).toHaveLength(8);
      expect(open(el)).toEqual([]);
    });

    it('opens the section that is pressed, and closes the one that was open, so only one is ever open', () => {
      const { fixture, el } = fp();

      press(fixture, heads(el)[1]);
      expect(open(el)).toEqual(['Units involved']);

      press(fixture, heads(el)[3]);
      expect(open(el)).toEqual(['Unit task']);
      expect(el.querySelectorAll('.body.is-open')).toHaveLength(1);
    });

    it('closes the open section when it is pressed again', () => {
      const { fixture, el } = fp();

      press(fixture, heads(el)[2]);
      press(fixture, heads(el)[2]);

      expect(open(el)).toEqual([]);
      expect(el.querySelectorAll('.body.is-open')).toHaveLength(0);
    });

    it('names each body by its heading, and points each heading at its body', () => {
      const { el } = fp();
      const head = heads(el)[0];
      const body = el.querySelector<HTMLElement>('#' + head.getAttribute('aria-controls'))!;

      expect(body.getAttribute('role')).toBe('region');
      expect(body.getAttribute('aria-labelledby')).toBe(head.id);
    });

    it('keeps what a filter shows while its section is closed, so the slide has something to reveal', () => {
      const { el } = fp();
      expect(el.querySelector('app-accordion-section app-unit-tree')).not.toBeNull();
    });
  });

  it('marks sections that have a filter set', () => {
    const { el } = fp({ ...NO_FILTERS, units: new Set([3310, 3259]), tasks: new Set(['Patrol']), mine: 'yes', text: 'ambush' });

    const summaries = [...el.querySelectorAll('app-accordion-section .toggle')].map((s) => s.textContent!.replace(/\s+/g, ' ').trim());
    expect(summaries).toEqual([
      'Dates and time',
      'Units involved 2',
      'Operation',
      'Unit task 1',
      'Data source',
      'Strength and casualties',
      'Mine incident 1',
      'Incident report 1',
    ]);
  });
});
