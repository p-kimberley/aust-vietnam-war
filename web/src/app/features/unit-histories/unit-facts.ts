import index from '@content/features/unit-histories/index.json';

// The list of unit histories (content/features/unit-histories/index.json, written by `Avw.Features unit-histories facts`; see
// content/features/README.md), bundled when the site is built. No API or database.

export interface TourSpan {
  /** yyyy-MM */
  from: string;
  to: string;
}

export interface UnitIndexEntry {
  slug: string;
  title: string;
  short: string;
  arm: string;
  tours: TourSpan[];
  contacts: number;
  operations: number;
  friendlyKilled: number;
  dead: number;
  subUnits: { slug: string; title: string; contacts: number }[];
}

/** The units with a history, in the order of units.csv. */
export const UNITS: readonly UnitIndexEntry[] = index.units;

/** The groups the list is shown in, by arm. */
export const ARM_GROUPS: readonly { name: string; arms: readonly string[] }[] = [
  { name: 'Infantry', arms: ['infantry'] },
  { name: 'Armour and cavalry', arms: ['cavalry', 'armour'] },
  { name: 'Special forces', arms: ['special-air-service'] },
  { name: 'Formation', arms: ['headquarters'] },
  { name: 'Artillery', arms: ['artillery'] },
  { name: 'Engineers', arms: ['engineers'] },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-05" → "May 2026". */
export function monthYear(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "1966-04..1967-05; 1969-02..1970-02" → "April 1966 – May 1967, February 1969 – February 1970". */
export function toursText(tours: readonly TourSpan[]): string {
  return tours.map((t) => `${monthYear(t.from)} – ${monthYear(t.to)}`).join(', ');
}
