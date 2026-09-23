import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { Contact } from './contacts';

export const TRACK_SOURCE = 'avw-tracks';
export const TRACK_CASING = 'avw-tracks-casing';
export const TRACK_LINE = 'avw-tracks-line';
export const TRACK_STOPS = 'avw-tracks-stops';

/** More units than this are not followed: their paths overlap in time, so joining their contacts would only tangle. */
export const MAX_SEPARATE_TRACKS = 6;

/** How often the dashes step forward; fast enough to read as motion, gentle enough not to distract from the map. */
const DASH_STEP_MS = 60;

/**
 * `line-dasharray` frames that, cycled in order, march the dashes from a track's oldest stop toward its newest (the
 * direction each line's coordinates are drawn in; see {@link toTrackGeoJson}). Mapbox's own worked example for this
 * effect, which this follows exactly: https://docs.mapbox.com/mapbox-gl-js/example/animate-a-line/
 */
const DASH_FRAMES: readonly number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

// Bright colours that read on both the dark and the light basemaps; map paint properties cannot read CSS variables.
export const TRACK_COLOURS = ['#ffd166', '#4cc9f0', '#b5e48c', '#f28482', '#cdb4db', '#ff9f1c'] as const;
const CASING = '#1f2314';

export interface Track {
  /** The unit id. */
  key: number;
  colour: string;
  /** The contacts in date order. */
  stops: Contact[];
}

/** What the incident panel shows beside a followed unit: the colour of its line, and how many incidents it has. */
export interface FollowInfo {
  colour: string;
  stops: number;
}

/** One row of the followed-units panel: a unit's line colour, and where the reader is along its path. */
export interface FollowRow {
  unit: number;
  label: string;
  /** The unit's full name, shown as a tooltip over the short label. */
  fullName: string;
  colour: string;
  /** 1-based position, among this unit's own incidents, of whichever one is open; `null` while none of them is. */
  at: number | null;
  total: number;
}

export type TrackProperties = { key: number; colour: string; order?: number; count?: number; end?: 'first' | 'last' | 'middle' };

/**
 * The path each chosen unit took: the contacts that involve it, in the order they happened. A unit's own contacts follow
 * one another, but a battalion's companies work side by side, so with more than {@link MAX_SEPARATE_TRACKS} units nothing
 * is drawn.
 */
export function buildTracks(contacts: readonly Contact[], unitIds: ReadonlySet<number>): Track[] {
  if (unitIds.size === 0 || unitIds.size > MAX_SEPARATE_TRACKS) {
    return [];
  }
  const inOrder = (list: Contact[]) => list.sort((a, b) => (a.dtg < b.dtg ? -1 : a.dtg > b.dtg ? 1 : a.id - b.id));

  return [...unitIds]
    .sort((a, b) => a - b)
    .map((unit, i) => ({ key: unit, colour: TRACK_COLOURS[i % TRACK_COLOURS.length], stops: inOrder(contacts.filter((c) => c.units.includes(unit))) }))
    .filter((t) => t.stops.length > 0);
}

/** The contact before or after `currentId` along a track, staying at the ends; with none selected, the first (or last, going back). */
export function neighbour(track: Track, currentId: number | null, direction: 1 | -1): Contact | null {
  if (track.stops.length === 0) {
    return null;
  }
  const at = track.stops.findIndex((c) => c.id === currentId);
  if (at < 0) {
    return direction === 1 ? track.stops[0] : track.stops[track.stops.length - 1];
  }
  return track.stops[Math.min(Math.max(at + direction, 0), track.stops.length - 1)];
}

/**
 * Which units a link asks to follow: `follow=` lists unit ids. An older link's `track=1` followed whichever units the filters
 * had chosen. More than {@link MAX_SEPARATE_TRACKS} follows nothing, since that many paths would only tangle.
 */
export function followedFromLink(follow: string | undefined, track: string | undefined, filterUnits: ReadonlySet<number>): ReadonlySet<number> {
  const ids = (follow ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const units = ids.length ? new Set(ids) : track === '1' ? new Set(filterUnits) : new Set<number>();
  return units.size <= MAX_SEPARATE_TRACKS ? units : new Set();
}

/** Contacts at exactly the same place add nothing to a line, so runs of them are drawn once. */
function distinctPlaces(stops: readonly Contact[]): Contact[] {
  return stops.filter((c, i) => i === 0 || c.lon !== stops[i - 1].lon || c.lat !== stops[i - 1].lat);
}

/** The lines and the stops along them, as GeoJSON. A track of a single place has stops but no line. */
export function toTrackGeoJson(tracks: readonly Track[]): FeatureCollection<LineString | Point, TrackProperties> {
  const features: Feature<LineString | Point, TrackProperties>[] = [];
  for (const t of tracks) {
    const places = distinctPlaces(t.stops);
    if (places.length >= 2) {
      features.push({
        type: 'Feature',
        properties: { key: t.key, colour: t.colour, count: t.stops.length },
        geometry: { type: 'LineString', coordinates: places.map((c) => [c.lon, c.lat]) },
      });
    }
    t.stops.forEach((c, i) => {
      features.push({
        type: 'Feature',
        properties: { key: t.key, colour: t.colour, order: i + 1, end: i === 0 ? 'first' : i === t.stops.length - 1 ? 'last' : 'middle' },
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      });
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Adds the track layers above the contact layers. Called after every style load, like the other layers. */
export function addTrackLayers(map: Map, tracks: readonly Track[], visible: boolean): void {
  if (!map.getSource(TRACK_SOURCE)) {
    map.addSource(TRACK_SOURCE, { type: 'geojson', data: toTrackGeoJson(tracks) });
  }
  const visibility = visible ? 'visible' : 'none';
  const colour: ExpressionSpecification = ['get', 'colour'];

  if (!map.getLayer(TRACK_CASING)) {
    map.addLayer({
      id: TRACK_CASING,
      type: 'line',
      source: TRACK_SOURCE,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round', visibility },
      paint: { 'line-color': CASING, 'line-width': 6, 'line-opacity': 0.6 },
    });
  }
  if (!map.getLayer(TRACK_LINE)) {
    map.addLayer({
      id: TRACK_LINE,
      type: 'line',
      source: TRACK_SOURCE,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-join': 'round', 'line-cap': 'round', visibility },
      // The starting frame of DASH_FRAMES, so the line looks right even before animateTracks has taken its first step.
      paint: { 'line-color': colour, 'line-width': 3, 'line-dasharray': DASH_FRAMES[0] },
    });
  }
  if (!map.getLayer(TRACK_STOPS)) {
    map.addLayer({
      id: TRACK_STOPS,
      type: 'circle',
      source: TRACK_SOURCE,
      filter: ['==', ['geometry-type'], 'Point'],
      layout: { visibility },
      paint: {
        'circle-color': colour,
        // The first and last contact are larger, so the direction of travel can be read.
        'circle-radius': ['case', ['==', ['get', 'end'], 'middle'], 3.5, 7] as ExpressionSpecification,
        'circle-stroke-color': CASING,
        'circle-stroke-width': 1.5,
      },
    });
  }
}

export function setTracks(map: Map, tracks: readonly Track[]): void {
  (map.getSource(TRACK_SOURCE) as GeoJSONSource | undefined)?.setData(toTrackGeoJson(tracks));
}

export function setTrackVisibility(map: Map, visible: boolean): void {
  for (const id of [TRACK_CASING, TRACK_LINE, TRACK_STOPS]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

/**
 * Steps the followed units' lines through {@link DASH_FRAMES}, so the dashes read as moving along each path, oldest
 * stop to newest; does nothing for a reader who has asked for less motion. The layer coming and going (a style change
 * discards it until the next `style.load`) needs no separate handling: a step onto a missing layer is just skipped.
 * Call the returned function to stop.
 */
export function animateTracks(map: Map): () => void {
  // Guarded rather than called plainly: jsdom (every spec that follows a unit runs through here) has no matchMedia.
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return () => {};
  }
  let frame = 0;
  const timer = setInterval(() => {
    frame = (frame + 1) % DASH_FRAMES.length;
    if (map.getLayer(TRACK_LINE)) {
      map.setPaintProperty(TRACK_LINE, 'line-dasharray', DASH_FRAMES[frame]);
    }
  }, DASH_STEP_MS);
  return () => clearInterval(timer);
}
