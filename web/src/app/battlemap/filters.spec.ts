import { describe, expect, it } from 'vitest';
import { CATALOGUE, CONTACTS, UNIT_NODES } from './filter-fixtures';
import {
  FilterState,
  NO_FILTERS,
  activeKeys,
  applyFilters,
  clearFilter,
  fromParams,
  hourOf,
  isActive,
  toParams,
} from './filters';
import { UnitTree } from './unit-tree';

const tree = new UnitTree(UNIT_NODES);
const ids = (state: Partial<FilterState>, textIds: ReadonlySet<number> | null = null) =>
  applyFilters(CONTACTS, { ...NO_FILTERS, ...state }, CATALOGUE, textIds).map((c) => c.id);

describe('UnitTree', () => {
  it('finds children, parents and the real units beneath a node', () => {
    expect(tree.roots).toEqual([3233, -1]);
    expect(tree.children(3233)).toEqual([3259, 3234]);
    expect(tree.parentOf(3310)).toBe(3259);
    expect(tree.parentOf(3233)).toBeNull();
    expect(tree.realUnits(3233)).toEqual([3233, 3259, 3310, 3234]);
    expect(tree.realUnits(-1)).toEqual([15838, 15839]);            // a group has no id of its own to select
    expect(tree.ancestors(15838)).toEqual([-2, -1]);
  });

  it('counts each contact once per node however many subordinate units it lists', () => {
    const counts = tree.countContacts(CONTACTS);

    expect(counts.get(3233)).toBe(2);                              // contact 2 lists two units under 1 RAR but counts once
    expect(counts.get(3259)).toBe(2);                              // contact 1 (via 1 Pl) and contact 2
    expect(counts.get(3310)).toBe(1);
    expect(counts.get(-1)).toBe(1);
    expect(counts.get(15839)).toBeUndefined();
  });

  it('reports a node as all, some or none selected', () => {
    expect(tree.stateOf(3233, new Set())).toBe('none');
    expect(tree.stateOf(3233, new Set([3310]))).toBe('some');
    expect(tree.stateOf(3259, new Set([3259, 3310]))).toBe('all');
    expect(tree.stateOf(3233, new Set(tree.realUnits(3233)))).toBe('all');
  });

  it('selects a whole subtree from a partial state and clears a full one', () => {
    const some = tree.toggle(3233, new Set([3310]));
    expect([...some].sort()).toEqual([3233, 3234, 3259, 3310].sort());

    expect(tree.toggle(3233, some).size).toBe(0);
    expect([...tree.toggle(3259, new Set([3233, 3259, 3310]))]).toEqual([3233]);   // deselecting a child leaves its parent unit
  });

  it('describes a selection compactly and restores it exactly', () => {
    const selection = new Set([3233, 3259, 3310, 3234, 15838]);
    const cover = tree.cover(selection);

    expect(cover).toEqual([{ id: 3233, subtree: true }, { id: 15838, subtree: true }]);
    expect(tree.expand(cover)).toEqual(selection);
  });

  it('names a unit on its own when its subordinates are not all selected', () => {
    const selection = new Set([3233, 3310]);                        // 1 RAR itself plus one platoon, not the rest
    const cover = tree.cover(selection);

    expect(cover).toEqual([{ id: 3233, subtree: false }, { id: 3310, subtree: true }]);
    expect(tree.expand(cover)).toEqual(selection);
  });

  it('round-trips every subset of the units', () => {
    const real = UNIT_NODES.filter((n) => n.id > 0).map((n) => n.id);
    for (let mask = 0; mask < 1 << real.length; mask++) {
      const selection = new Set(real.filter((_, i) => mask & (1 << i)));
      expect(tree.expand(tree.cover(selection))).toEqual(selection);
    }
  });

  it('ignores ids that are not in the tree', () => {
    expect(tree.expand([{ id: 424242, subtree: true }, { id: 424243, subtree: false }]).size).toBe(0);
  });

  it('searches label and full name, showing matches with their ancestors and descendants', () => {
    const r = tree.search('d coy')!;

    expect(r.visible).toEqual(new Set([3233, 3234, 15838, -1, -2]));
    expect(r.open).toEqual(new Set([3233, -1, -2]));                // parents to expand so the matches can be seen
    expect(tree.search('armor')!.visible).toEqual(new Set([-1, -2, 15838, 15839]));
    expect(tree.search('   ')).toBeNull();
    expect(tree.search('nothing like this')!.visible.size).toBe(0);
  });

  it('matches every word, in any order', () => {
    expect(tree.search('platoon rar')!.visible).toEqual(new Set([3310, 3259, 3233]));
    expect(tree.search('rar platoon')!.visible).toEqual(new Set([3310, 3259, 3233]));
  });
});

describe('applyFilters', () => {
  it('passes everything when nothing is active', () => {
    expect(ids({})).toEqual([1, 2, 3, 4]);
  });

  it('limits by date, inclusive of both ends', () => {
    expect(ids({ from: '1966-03-05' })).toEqual([2, 3, 4]);
    expect(ids({ to: '1966-03-05' })).toEqual([1, 2]);
    expect(ids({ from: '1966-03-05', to: '1966-03-05' })).toEqual([2]);
    expect(ids({ from: '1971-11-02' })).toEqual([4]);
  });

  it('limits by hour of day as recorded', () => {
    expect(ids({ hours: [19, 23] })).toEqual([1, 4]);
    expect(ids({ hours: [0, 0] })).toEqual([3]);                    // 00:30
    expect(hourOf('1966-03-03T19:50:00')).toBe(19);
    expect(hourOf('1966-03-03')).toBeNaN();
  });

  it('limits by strength and casualty ranges, all inclusive', () => {
    expect(ids({ fr: [30, 700] })).toEqual([2, 3]);
    expect(ids({ frCas: [2, 2] })).toEqual([2]);
    expect(ids({ en: [5, 12] })).toEqual([1, 2]);
    expect(ids({ enCas: [1, 7] })).toEqual([2]);
    expect(ids({ fr: [30, 700], en: [10, 12] })).toEqual([2]);       // filters combine
  });

  it('matches any selected unit, and contacts with no unit never match a unit filter', () => {
    expect(ids({ units: new Set([3310]) })).toEqual([1]);
    expect(ids({ units: new Set([3259, 15838]) })).toEqual([2, 3]);          // exact ids: contact 1 lists only 1 Pl, a subordinate of 3259
    expect(ids({ units: new Set(tree.realUnits(3233)) })).toEqual([1, 2]);
    expect(ids({ units: new Set([424242]) })).toEqual([]);
  });

  it('matches operations, tasks and data sources by name, so a contact with none never matches', () => {
    expect(ids({ operations: new Set(['Hardihood, Phase 2']) })).toEqual([1, 4]);
    expect(ids({ operations: new Set(['Coburg', 'Hardihood, Phase 2']) })).toEqual([1, 2, 4]);
    expect(ids({ tasks: new Set(['Ambush']) })).toEqual([2]);
    expect(ids({ series: new Set(['1RAR']) })).toEqual([3]);
    expect(ids({ operations: new Set(['Not an operation']) })).toEqual([]);
  });

  it('treats a mine incident as yes, no, or not recorded', () => {
    expect(ids({ mine: 'yes' })).toEqual([2]);
    expect(ids({ mine: 'no' })).toEqual([1, 4]);                     // contact 3 has none recorded and matches neither
    expect(ids({ mine: 'any' })).toEqual([1, 2, 3, 4]);
  });

  it('applies the text result only once the server has answered', () => {
    expect(ids({ text: 'claymore' }, new Set([2, 3]))).toEqual([2, 3]);
    expect(ids({ text: 'claymore' }, null)).toEqual([1, 2, 3, 4]);   // still searching: not applied yet
    expect(ids({ text: 'c' }, new Set([2]))).toEqual([1, 2, 3, 4]);  // too short to search: ignored
    expect(ids({ text: 'claymore', fr: [30, 700] }, new Set([1, 2]))).toEqual([2]);
  });

  it('does not change the contacts it is given', () => {
    const before = JSON.stringify(CONTACTS);
    ids({ fr: [30, 700], units: new Set([3259]) });
    expect(JSON.stringify(CONTACTS)).toBe(before);
  });
});

describe('active filters', () => {
  it('lists what is active in a stable order and can clear each one', () => {
    const state: FilterState = {
      ...NO_FILTERS, from: '1966-01-01', hours: [6, 18], units: new Set([3310]), operations: new Set(['Coburg']), mine: 'yes', text: 'ambush',
    };

    expect(activeKeys(state)).toEqual(['dates', 'hours', 'units', 'operations', 'mine', 'text']);
    for (const key of activeKeys(state)) {
      expect(isActive(clearFilter(state, key), key)).toBe(false);
    }
    expect(activeKeys(NO_FILTERS)).toEqual([]);
    expect(activeKeys(activeKeys(state).reduce(clearFilter, state) as never)).toEqual([]);
  });

  it('does not count search text that is too short', () => {
    expect(isActive({ ...NO_FILTERS, text: ' a ' }, 'text')).toBe(false);
  });
});

describe('filter URL parameters', () => {
  const full: FilterState = {
    from: '1966-03-05',
    to: '1968-12-31',
    hours: [6, 18],
    fr: [10, 500],
    frCas: [1, 30],
    en: [2, 10],
    enCas: [1, 5],
    units: new Set(tree.realUnits(3233)),
    operations: new Set(['Hardihood, Phase 2', 'Coburg']),
    tasks: new Set(['Patrol']),
    series: new Set(['1ATF']),
    mine: 'no',
    text: 'claymore mine',
  };

  it('writes only what is active, in a readable form', () => {
    expect(toParams(NO_FILTERS, tree)).toEqual({
      from: null, to: null, hours: null, fr: null, frcas: null, en: null, encas: null, units: null, ops: null, tasks: null, series: null, mine: null, q: null,
    });
    const p = toParams(full, tree);
    expect(p['from']).toBe('1966-03-05');
    expect(p['hours']).toBe('6-18');
    expect(p['frcas']).toBe('1-30');
    expect(p['units']).toBe('3233');                                  // a whole battalion is one entry
    expect(p['ops']).toEqual(['Hardihood, Phase 2', 'Coburg']);        // names keep their commas
    expect(p['mine']).toBe('no');
    expect(p['q']).toBe('claymore mine');
  });

  it('round-trips a full state', () => {
    expect(fromParams(toParams(full, tree) as never, CATALOGUE, tree)).toEqual(full);
  });

  it('round-trips through the URL text itself', () => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(toParams(full, tree))) {
      for (const x of v === null ? [] : Array.isArray(v) ? v : [v]) search.append(k, x);
    }
    const back = new URLSearchParams(search.toString());
    const raw = Object.fromEntries([...new Set(back.keys())].map((k) => [k, back.getAll(k).length > 1 ? back.getAll(k) : back.get(k)!]));

    expect(fromParams(raw as never, CATALOGUE, tree)).toEqual(full);
  });

  it('accepts a single repeated name as a plain string', () => {
    expect(fromParams({ ops: 'Coburg', series: '1ATF' }, CATALOGUE, tree).operations).toEqual(new Set(['Coburg']));
  });

  it('keeps a unit named on its own separate from its subtree', () => {
    const state: FilterState = { ...NO_FILTERS, units: new Set([3233, 3310]) };
    const p = toParams(state, tree);

    expect(p['units']).toBe('3233!,3310');
    expect(fromParams(p as never, CATALOGUE, tree).units).toEqual(state.units);
  });

  it('ignores anything invalid or unknown instead of failing', () => {
    const s = fromParams({
      from: 'not-a-date', to: '1966-13-45', hours: 'x-y', fr: '5', frcas: '1-2-3', units: 'abc,,99999999!,7q', ops: ['Nope', 'Coburg'],
      tasks: 'Nope', series: 'Nope', mine: 'maybe', q: 'x',
    }, CATALOGUE, tree);

    expect(s).toEqual({ ...NO_FILTERS, operations: new Set(['Coburg']) });
  });

  it('clamps ranges and dates to the data, orders reversed limits, and treats full extents as no filter', () => {
    const s = fromParams({ fr: '900-5', en: '0-12', hours: '0-23', from: '1900-01-01', to: '1971-11-02' }, CATALOGUE, tree);

    expect(s.fr).toEqual([5, 700]);
    expect(s.en).toBeNull();
    expect(s.hours).toBeNull();
    expect(s.from).toBeNull();                                        // clamped to the first day of data, which is no limit
    expect(s.to).toBeNull();
    expect(fromParams({ from: '1970-01-01', to: '1966-06-01' }, CATALOGUE, tree)).toMatchObject({ from: '1966-06-01', to: '1970-01-01' });
  });

  it('limits search text to a sensible length', () => {
    expect(fromParams({ q: 'x'.repeat(500) }, CATALOGUE, tree).text).toHaveLength(100);
  });
});
