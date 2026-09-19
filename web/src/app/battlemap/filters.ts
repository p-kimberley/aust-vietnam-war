import { Contact, formatDtg } from './contacts';
import { FilterCatalogue, RangeInfo } from './filter-catalogue';
import { CoverEntry, UnitTree } from './unit-tree';

export type Mine = 'any' | 'yes' | 'no';
export type Range = readonly [number, number];
export type RangeKey = 'fr' | 'frCas' | 'en' | 'enCas';

/** Search text shorter than this is ignored: one letter matches nearly everything. */
export const MIN_TEXT_LENGTH = 2;

/** The values chosen in the filter panel. A filter that is left at its default is `null`, empty or `any`. */
export interface FilterState {
  /** `yyyy-MM-dd`, inclusive. `null` means no limit on that side. */
  from: string | null;
  to: string | null;
  /** Hour of day as recorded, 0 to 23, inclusive. */
  hours: Range | null;
  fr: Range | null;
  frCas: Range | null;
  en: Range | null;
  enCas: Range | null;
  /** Real unit ids. A contact matches when it involves any of them. */
  units: ReadonlySet<number>;
  operations: ReadonlySet<string>;
  tasks: ReadonlySet<string>;
  series: ReadonlySet<string>;
  mine: Mine;
  /** Words that must all appear in the incident report. Resolved by the server, see {@link applyFilters}. */
  text: string;
}

export const NO_FILTERS: FilterState = {
  from: null,
  to: null,
  hours: null,
  fr: null,
  frCas: null,
  en: null,
  enCas: null,
  units: new Set(),
  operations: new Set(),
  tasks: new Set(),
  series: new Set(),
  mine: 'any',
  text: '',
};

export type FilterKey = 'dates' | 'hours' | RangeKey | 'units' | 'operations' | 'tasks' | 'series' | 'mine' | 'text';

export const FILTER_KEYS: readonly FilterKey[] = [
  'dates', 'hours', 'fr', 'frCas', 'en', 'enCas', 'units', 'operations', 'tasks', 'series', 'mine', 'text',
];

export function hasText(state: FilterState): boolean {
  return state.text.trim().length >= MIN_TEXT_LENGTH;
}

export function isActive(state: FilterState, key: FilterKey): boolean {
  switch (key) {
    case 'dates':
      return state.from !== null || state.to !== null;
    case 'hours':
    case 'fr':
    case 'frCas':
    case 'en':
    case 'enCas':
      return state[key] !== null;
    case 'units':
    case 'operations':
    case 'tasks':
    case 'series':
      return state[key].size > 0;
    case 'mine':
      return state.mine !== 'any';
    case 'text':
      return hasText(state);
  }
}

export function activeKeys(state: FilterState): FilterKey[] {
  return FILTER_KEYS.filter((k) => isActive(state, k));
}

/** Returns the state with one filter put back to its default. */
export function clearFilter(state: FilterState, key: FilterKey): FilterState {
  switch (key) {
    case 'dates':
      return { ...state, from: null, to: null };
    case 'hours':
    case 'fr':
    case 'frCas':
    case 'en':
    case 'enCas':
      return { ...state, [key]: null };
    case 'units':
    case 'operations':
    case 'tasks':
    case 'series':
      return { ...state, [key]: new Set() };
    case 'mine':
      return { ...state, mine: 'any' };
    case 'text':
      return { ...state, text: '' };
  }
}

/** The hour recorded in a DTG (`yyyy-MM-ddTHH:mm:ss`), or `NaN` when it has no time. */
export function hourOf(dtg: string): number {
  return dtg.length >= 13 ? Number(dtg.slice(11, 13)) : NaN;
}

function within(value: number, range: Range | null): boolean {
  return range === null || (value >= range[0] && value <= range[1]);
}

/** Positions (1-based, as contacts store them) of the chosen names in a catalogue list. */
function positions(names: ReadonlySet<string>, list: readonly { name: string }[]): Set<number> {
  const out = new Set<number>();
  list.forEach((entry, i) => {
    if (names.has(entry.name)) out.add(i + 1);
  });
  return out;
}

/**
 * The contacts that pass every active filter. Text is matched by the server (the reports are far too large to ship to
 * every browser), so `textIds` carries its answer: while it is `null` (a search is still running) the text filter is
 * not applied, and the previous result stays on the map until the new one arrives.
 */
export function applyFilters(
  contacts: readonly Contact[],
  state: FilterState,
  catalogue: FilterCatalogue,
  textIds: ReadonlySet<number> | null,
): Contact[] {
  const ops = positions(state.operations, catalogue.operations);
  const tasks = positions(state.tasks, catalogue.tasks);
  const series = positions(state.series, catalogue.series);
  const useOps = state.operations.size > 0;
  const useTasks = state.tasks.size > 0;
  const useSeries = state.series.size > 0;
  const useUnits = state.units.size > 0;
  const useHours = state.hours !== null;
  const useText = hasText(state) && textIds !== null;

  return contacts.filter((c) => {
    const date = c.dtg.slice(0, 10);
    if (state.from !== null && date < state.from) return false;
    if (state.to !== null && date > state.to) return false;
    if (useHours && !within(hourOf(c.dtg), state.hours)) return false;
    if (!within(c.fr, state.fr) || !within(c.frCas, state.frCas) || !within(c.en, state.en) || !within(c.enCas, state.enCas)) {
      return false;
    }
    if (useOps && !ops.has(c.op)) return false;
    if (useTasks && !tasks.has(c.task)) return false;
    if (useSeries && !series.has(c.series)) return false;
    if (state.mine === 'yes' && c.mine !== 2) return false;
    if (state.mine === 'no' && c.mine !== 1) return false;
    if (useUnits && !c.units.some((u) => state.units.has(u))) return false;
    if (useText && !textIds.has(c.id)) return false;
    return true;
  });
}

// ---- Wording ---------------------------------------------------------------------------------------------------

const SERIES_NAMES: Record<string, string> = { '1ATF': '1st Australian Task Force', '1RAR': '1 RAR Battalion Group' };

/** The data-source names as the legacy map showed them, falling back to the recorded name. */
export function seriesLabel(name: string): string {
  return SERIES_NAMES[name] ?? name;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A short phrase for an active filter, shown on its removable chip. */
export function describeFilter(state: FilterState, key: FilterKey): string {
  const span = (r: Range | null) => (r ? `${r[0]}–${r[1]}` : '');
  const many = (set: ReadonlySet<string>, one: string, some: string) =>
    set.size === 1 ? `${one}: ${[...set][0]}` : `${some}: ${set.size}`;
  switch (key) {
    case 'dates':
      return state.from && state.to
        ? `Dates ${formatDtg(state.from)} – ${formatDtg(state.to)}`
        : state.from
          ? `From ${formatDtg(state.from)}`
          : `Up to ${formatDtg(state.to ?? '')}`;
    case 'hours':
      return state.hours ? `Hours ${pad(state.hours[0])}–${pad(state.hours[1])}` : '';
    case 'fr':
      return `Friendly strength ${span(state.fr)}`;
    case 'frCas':
      return `Friendly casualties ${span(state.frCas)}`;
    case 'en':
      return `Enemy strength ${span(state.en)}`;
    case 'enCas':
      return `Enemy casualties ${span(state.enCas)}`;
    case 'units':
      return state.units.size === 1 ? '1 unit' : `${state.units.size} units`;
    case 'operations':
      return many(state.operations, 'Operation', 'Operations');
    case 'tasks':
      return many(state.tasks, 'Task', 'Tasks');
    case 'series':
      return [...state.series].map(seriesLabel).join(', ');
    case 'mine':
      return `Mine incident: ${state.mine}`;
    case 'text':
      return `Report contains “${state.text.trim()}”`;
  }
}

// ---- URL ------------------------------------------------------------------------------------------------------

/**
 * Query parameters for a filter state; anything at its default is `null` so the router drops it. Ranges are
 * `min-max`, units are node ids with a `!` after a unit that is named on its own (see {@link UnitTree.cover}), and
 * names are repeated parameters so commas and other punctuation in them need no escaping of our own.
 */
export type FilterParams = Record<string, string | string[] | null>;

const RANGE_PARAM: Record<RangeKey | 'hours', string> = { hours: 'hours', fr: 'fr', frCas: 'frcas', en: 'en', enCas: 'encas' };

export function toParams(state: FilterState, tree: UnitTree): FilterParams {
  const range = (r: Range | null) => (r ? `${r[0]}-${r[1]}` : null);
  const names = (s: ReadonlySet<string>) => (s.size > 0 ? [...s] : null);
  return {
    from: state.from,
    to: state.to,
    [RANGE_PARAM.hours]: range(state.hours),
    [RANGE_PARAM.fr]: range(state.fr),
    [RANGE_PARAM.frCas]: range(state.frCas),
    [RANGE_PARAM.en]: range(state.en),
    [RANGE_PARAM.enCas]: range(state.enCas),
    units: state.units.size > 0 ? tree.cover(state.units).map((e) => `${e.id}${e.subtree ? '' : '!'}`).join(',') : null,
    ops: names(state.operations),
    tasks: names(state.tasks),
    series: names(state.series),
    mine: state.mine === 'any' ? null : state.mine,
    q: hasText(state) ? state.text.trim() : null,
  };
}

export const FILTER_PARAM_NAMES = ['from', 'to', 'hours', 'fr', 'frcas', 'en', 'encas', 'units', 'ops', 'tasks', 'series', 'mine', 'q'] as const;

type RawParams = Partial<Record<(typeof FILTER_PARAM_NAMES)[number], string | string[] | undefined>>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const all = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | undefined, catalogue: FilterCatalogue): string | null {
  if (!value || !DATE.test(value) || Number.isNaN(Date.parse(value))) return null;
  // Clamp to the data, so a link cannot leave the panel showing a range nothing can match.
  return value < catalogue.dateMin ? catalogue.dateMin : value > catalogue.dateMax ? catalogue.dateMax : value;
}

function parseRange(value: string | undefined, bounds: RangeInfo): Range | null {
  const m = /^(\d+)-(\d+)$/.exec(value ?? '');
  if (!m) return null;
  let lo = Math.max(bounds.min, Math.min(Number(m[1]), bounds.max));
  let hi = Math.max(bounds.min, Math.min(Number(m[2]), bounds.max));
  if (lo > hi) [lo, hi] = [hi, lo];
  return lo === bounds.min && hi === bounds.max ? null : [lo, hi];
}

function known(names: string[], list: readonly { name: string }[]): Set<string> {
  const valid = new Set(list.map((e) => e.name));
  return new Set(names.filter((n) => valid.has(n)));
}

/** The inverse of {@link toParams}. Anything invalid or unknown is ignored rather than rejected. */
export function fromParams(raw: RawParams, catalogue: FilterCatalogue, tree: UnitTree): FilterState {
  let from = validDate(first(raw.from), catalogue);
  let to = validDate(first(raw.to), catalogue);
  if (from !== null && to !== null && from > to) [from, to] = [to, from];
  // A limit at the very edge of the data is no limit at all.
  if (from === catalogue.dateMin) from = null;
  if (to === catalogue.dateMax) to = null;

  const entries: CoverEntry[] = [];
  for (const token of (first(raw.units) ?? '').split(',')) {
    const m = /^(-?\d+)(!?)$/.exec(token.trim());
    if (m) entries.push({ id: Number(m[1]), subtree: m[2] !== '!' });
  }

  const mine = first(raw.mine);
  const text = (first(raw.q) ?? '').trim();
  return {
    from,
    to,
    hours: parseRange(first(raw.hours), { min: 0, max: 23 }),
    fr: parseRange(first(raw.fr), catalogue.fr),
    frCas: parseRange(first(raw.frcas), catalogue.frCas),
    en: parseRange(first(raw.en), catalogue.en),
    enCas: parseRange(first(raw.encas), catalogue.enCas),
    units: tree.expand(entries),
    operations: known(all(raw.ops), catalogue.operations),
    tasks: known(all(raw.tasks), catalogue.tasks),
    series: known(all(raw.series), catalogue.series),
    mine: mine === 'yes' || mine === 'no' ? mine : 'any',
    text: text.length >= MIN_TEXT_LENGTH ? text.slice(0, 100) : '',
  };
}
