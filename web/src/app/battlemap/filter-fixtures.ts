import { Contact } from './contacts';
import { FilterCatalogue, UnitNode } from './filter-catalogue';

/** Shared by the filter specs. A small hierarchy that includes synthetic groups (negative ids). */
export const UNIT_NODES: UnitNode[] = [
  { id: 3233, parent: null, label: '1 RAR', name: '1 Battalion, Royal Australian Regiment', synthetic: false },
  { id: 3259, parent: 3233, label: 'A Coy', name: 'A Company, 1 RAR', synthetic: false },
  { id: 3310, parent: 3259, label: '1 Pl', name: '1 Platoon, A Coy, 1 RAR', synthetic: false },
  { id: 3234, parent: 3233, label: 'D Coy', name: 'D Company, 1 RAR', synthetic: false },
  { id: -1, parent: null, label: 'US Army', name: 'US Army', synthetic: true },
  { id: -2, parent: -1, label: '16 Armor Battalion', name: '16 Armor Battalion', synthetic: true },
  { id: 15838, parent: -2, label: 'D Coy', name: 'D Company, 16 Armor Bn, US Army', synthetic: false },
  { id: 15839, parent: -2, label: 'E Coy', name: 'E Company, 16 Armor Bn, US Army', synthetic: false },
];

export const CATALOGUE: FilterCatalogue = {
  dateMin: '1966-03-03',
  dateMax: '1971-11-02',
  fr: { min: 0, max: 700 },
  frCas: { min: 0, max: 38 },
  en: { min: 0, max: 12 },
  enCas: { min: 0, max: 7 },
  series: [
    { name: '1ATF', count: 3 },
    { name: '1RAR', count: 1 },
  ],
  operations: [
    { name: 'Coburg', count: 1 },
    { name: 'Hardihood, Phase 2', count: 2 },
  ],
  tasks: [
    { name: 'Ambush', count: 1 },
    { name: 'Patrol', count: 2 },
  ],
  units: UNIT_NODES,
};

function contact(c: Partial<Contact> & Pick<Contact, 'id' | 'dtg'>): Contact {
  return { lat: 10.5, lon: 107.1, fr: 0, frCas: 0, en: 0, enCas: 0, units: [], op: 0, task: 0, series: 1, mine: 0, ...c };
}

export const CONTACTS: Contact[] = [
  contact({ id: 1, dtg: '1966-03-03T19:50:00', fr: 25, en: 5, units: [3310], op: 2, task: 2, series: 1, mine: 1 }),
  contact({ id: 2, dtg: '1966-03-05T08:10:00', fr: 40, frCas: 2, en: 12, enCas: 7, units: [3259, 3234], op: 1, task: 1, series: 1, mine: 2 }),
  contact({ id: 3, dtg: '1967-06-01T00:30:00', fr: 700, frCas: 38, units: [15838], series: 2 }),
  contact({ id: 4, dtg: '1971-11-02T23:59:00', op: 2, task: 2, series: 1, mine: 1 }),
];
