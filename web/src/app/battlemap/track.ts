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
      paint: { 'line-color': colour, 'line-width': 3, 'line-dasharray': [2, 1.2] },
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
