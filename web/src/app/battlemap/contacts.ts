import type { Feature, FeatureCollection, Point } from 'geojson';

/** One contact as served by `GET /api/contacts`: just what the map needs to draw and filter. */
export interface Contact {
  id: number;
  /** Local date-time group as recorded, without a zone (for example `1966-03-03T19:50:00`). */
  dtg: string;
  lat: number;
  lon: number;
  /** Friendly force present. */
  fr: number;
  /** Total friendly casualties. */
  frCas: number;
  /** Enemy force. */
  en: number;
  /** Total enemy casualties. */
  enCas: number;
  /** Friendly killed in action. */
  frKia: number;
  /** Friendly wounded in action. */
  frWia: number;
  /** Enemy killed in action. */
  enKia: number;
  /** Enemy wounded in action. */
  enWia: number;
  /** Ids of the friendly units involved. */
  units: number[];
  /** 1-based position in the catalogue's operations; 0 when none is recorded. */
  op: number;
  /** 1-based position in the catalogue's unit tasks; 0 when none is recorded. */
  task: number;
  /** 1-based position in the catalogue's data sources; 0 when unknown. */
  series: number;
  /** 0 not recorded, 1 no mine incident, 2 mine incident. */
  mine: number;
}

/** A friendly unit involved in a contact. */
export interface ContactUnit {
  id: number;
  shortName: string;
  longName: string;
}

/** Mirrors `GET /api/contacts/{id}`: everything the incident panel shows for one contact. */
export interface ContactDetail {
  id: number;
  dtg: string;
  lat: number;
  lon: number;
  gridRef: string | null;
  operation: string | null;
  unitTask: string | null;
  units: ContactUnit[];
  frForce: number;
  enForce: number;
  frKia: number;
  frWia: number;
  enKia: number;
  enWia: number;
  /** The original incident report. */
  description: string | null;
  archivalSource: string | null;
  /** An absolute http(s) URL, already vetted by the API. */
  sourceUrl: string | null;
  /** The report in plain English, written by an AI model from the original; missing or null where there is none. */
  summary?: string | null;
}

export type HeatField = 'fr' | 'frCas' | 'en' | 'enCas';

/** The values a heatmap can be weighted by, named as in the legacy map. */
export const HEAT_FIELDS: readonly { value: HeatField; name: string }[] = [
  { value: 'fr', name: 'Size of friendly force' },
  { value: 'frCas', name: 'Friendly casualties' },
  { value: 'en', name: 'Size of enemy force' },
  { value: 'enCas', name: 'Enemy casualties' },
];

export const DEFAULT_HEAT_FIELD: HeatField = 'fr';

export function isHeatField(value: unknown): value is HeatField {
  return HEAT_FIELDS.some((f) => f.value === value);
}

/** What a point marker can be scaled by. Unlike the heatmap's fields these include killed and wounded. */
export type SizeField = 'fr' | 'frKia' | 'frWia' | 'en' | 'enKia' | 'enWia';

export const SIZE_FIELDS: readonly { value: SizeField; name: string }[] = [
  { value: 'fr', name: 'Size of friendly force' },
  { value: 'frKia', name: 'Friendly force killed' },
  { value: 'frWia', name: 'Friendly force wounded' },
  { value: 'en', name: 'Size of enemy force' },
  { value: 'enKia', name: 'Enemy force killed' },
  { value: 'enWia', name: 'Enemy force wounded' },
];

export function isSizeField(value: unknown): value is SizeField {
  return SIZE_FIELDS.some((f) => f.value === value);
}

/**
 * The value at which a marker reaches its largest size: the 95th percentile of the non-zero values, so that a few
 * very large engagements do not shrink every other marker to a dot. 0 when the field is never recorded.
 */
export function sizeCap(contacts: readonly Contact[], field: SizeField): number {
  const values = contacts.map((c) => c[field]).filter((v) => v > 0).sort((a, b) => a - b);
  return values.length === 0 ? 0 : values[Math.min(values.length - 1, Math.floor(values.length * 0.95))];
}

export interface Range {
  min: number;
  max: number;
}

/** Smallest and largest value of a field, used to normalise heatmap weights to 0..1. */
export function fieldRange(contacts: readonly Contact[], field: HeatField): Range {
  if (contacts.length === 0) {
    return { min: 0, max: 0 };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const c of contacts) {
    const v = c[field];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

export type ContactProperties = Pick<Contact, 'id' | 'dtg' | 'op' | 'fr' | 'frCas' | 'en' | 'enCas' | 'frKia' | 'frWia' | 'enKia' | 'enWia'>;

/** GeoJSON is what the map library consumes; the id doubles as the feature id so clicks can be traced back. */
export function toGeoJson(contacts: readonly Contact[]): FeatureCollection<Point, ContactProperties> {
  const features: Feature<Point, ContactProperties>[] = contacts.map((c) => ({
    type: 'Feature',
    id: c.id,
    geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
    properties: {
      id: c.id,
      dtg: c.dtg,
      op: c.op,
      fr: c.fr,
      frCas: c.frCas,
      en: c.en,
      enCas: c.enCas,
      frKia: c.frKia,
      frWia: c.frWia,
      enKia: c.enKia,
      enWia: c.enWia,
    },
  }));
  return { type: 'FeatureCollection', features };
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Formats a DTG for display. The value has no zone (it is local time in Vietnam), so it is read as UTC and
 * formatted as UTC to keep the printed date and time exactly as recorded, whatever the visitor's time zone.
 */
export function formatDtg(dtg: string): string {
  const d = new Date(dtg.endsWith('Z') ? dtg : `${dtg}Z`);
  if (Number.isNaN(d.getTime())) {
    return dtg;
  }
  const time = dtg.length > 10 ? ` ${dtg.slice(11, 16)}` : '';
  return `${DATE_FORMAT.format(d)}${time}`;
}
