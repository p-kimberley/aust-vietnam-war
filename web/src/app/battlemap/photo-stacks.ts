import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { GeoJSONSource, Map } from 'maplibre-gl';

export const STACK_SOURCE = 'avw-photos-stacks';
export const STACK_BADGES = 'avw-photos-stack-badges';
export const STACK_COUNTS = 'avw-photos-stack-counts';

// Colours match the style guide tokens in styles.scss; map paint properties cannot read CSS variables.
const INK = '#22251a';
const SMOKE_YELLOW = '#e3b92e';

/** Pictures whose middles are this close on the screen, in pixels, hide each other as thumbnails: a stack. */
export const STACK_BADGE_PX = 24;
/** Badges show from the zoom thumbnails start to (below it, pictures group into numbered discs that say how many already). */
const BADGE_MIN_ZOOM = 14;
/** Where the badge sits from the middle of a thumbnail, in pixels at its usual size: on its top right corner. */
const BADGE_OFFSET: [number, number] = [24, -19];
const GROW_FROM = 18;
const MAX_ZOOM = 22;
const GROWTH_PER_ZOOM = 0.5;

type Place = { id: number; lon: number; lat: number };

/** A place on the map in pixels at a zoom, from the top left of the world (Web Mercator, 512-pixel tiles, as MapLibre draws). */
export function worldPixels(p: { lon: number; lat: number }, zoom: number): [number, number] {
  const scale = (512 * 2 ** zoom) / (2 * Math.PI);
  const lat = (Math.max(Math.min(p.lat, 85), -85) * Math.PI) / 180;
  return [scale * ((p.lon * Math.PI) / 180 + Math.PI), scale * (Math.PI - Math.log(Math.tan(Math.PI / 4 + lat / 2)))];
}

/**
 * The pictures that lie on top of each other at a zoom: those whose middles are within `px` of another's, chained, so three in a
 * row a little apart are one stack. Only stacks of two or more are returned, each in the order the pictures were given.
 */
export function findStacks(pictures: readonly Place[], zoom: number, px = STACK_BADGE_PX): Place[][] {
  const points = pictures.map((p) => worldPixels(p, zoom));
  const parent = pictures.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  // Pictures fall into cells a stack's width across, so each is compared only with those in its own cell and the eight round it.
  const cells = new globalThis.Map<string, number[]>();
  points.forEach(([x, y], i) => {
    const cx = Math.floor(x / px);
    const cy = Math.floor(y / px);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(x - points[j][0], y - points[j][1]) <= px) parent[root(i)] = root(j);
        }
      }
    }
    const key = `${cx},${cy}`;
    cells.set(key, [...(cells.get(key) ?? []), i]);
  });
  const groups = new globalThis.Map<number, Place[]>();
  pictures.forEach((p, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), p]));
  return [...groups.values()].filter((g) => g.length > 1);
}

/** One badge per stack, at its middle, saying how many pictures are in it and which (as `,5,6,7,`, so one id can be looked for). */
export function toStackGeoJson(stacks: readonly Place[][]): FeatureCollection<Point, { count: number; ids: string }> {
  const features: Feature<Point, { count: number; ids: string }>[] = stacks.map((s) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [s.reduce((a, p) => a + p.lon, 0) / s.length, s.reduce((a, p) => a + p.lat, 0) / s.length] },
    properties: { count: s.length, ids: `,${s.map((p) => p.id).join(',')},` },
  }));
  return { type: 'FeatureCollection', features };
}

/** The ids of the pictures in a badge's stack, from its `ids` property. */
export function stackIds(ids: unknown): number[] {
  return String(ids ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number);
}

/** The badge's offset at each zoom, growing as the thumbnails do from zoom 18. */
function offset(): ExpressionSpecification {
  const grown = 1 + (MAX_ZOOM - GROW_FROM) * GROWTH_PER_ZOOM;
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    GROW_FROM,
    ['literal', BADGE_OFFSET],
    MAX_ZOOM,
    ['literal', [BADGE_OFFSET[0] * grown, BADGE_OFFSET[1] * grown]],
  ];
}

/** Badges for stacks except those holding any of these pictures (which are spread out just now). */
export function stackFilter(hidden: readonly number[]): ExpressionSpecification {
  return hidden.length ? ['!', ['any', ...hidden.map((id): ExpressionSpecification => ['in', `,${id},`, ['get', 'ids']])]] : ['has', 'count'];
}

const visibility = (visible: boolean) => (visible ? 'visible' : 'none');

/**
 * Adds the stack badges: a small numbered disc on the corner of a thumbnail with others hidden under it, saying how many pictures are
 * there. It starts empty: stacks depend on the zoom (pictures apart at 17 lie on each other at 14), so they are worked out by
 * {@link setStacks} once the style is loaded, and again whenever the zoom settles.
 */
export function addStackLayers(map: Map, visible: boolean): void {
  if (!map.getSource(STACK_SOURCE)) {
    map.addSource(STACK_SOURCE, { type: 'geojson', data: toStackGeoJson([]) });
  }
  if (!map.getLayer(STACK_BADGES)) {
    map.addLayer({
      id: STACK_BADGES,
      type: 'circle',
      source: STACK_SOURCE,
      minzoom: BADGE_MIN_ZOOM,
      filter: stackFilter([]),
      layout: { visibility: visibility(visible) },
      paint: { 'circle-radius': 10, 'circle-color': SMOKE_YELLOW, 'circle-stroke-color': INK, 'circle-stroke-width': 2, 'circle-translate': offset() },
    });
  }
  if (!map.getLayer(STACK_COUNTS)) {
    map.addLayer({
      id: STACK_COUNTS,
      type: 'symbol',
      source: STACK_SOURCE,
      minzoom: BADGE_MIN_ZOOM,
      filter: stackFilter([]),
      layout: {
        visibility: visibility(visible),
        'text-field': ['to-string', ['get', 'count']],
        // A face that every style's glyph set already has.
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': INK, 'text-translate': offset() },
    });
  }
}

/**
 * Works the stacks out again, for the zoom the map is at now and the pictures it has. `px` is how close counts as a stack; it grows
 * with the thumbnails, which grow from zoom 18.
 */
export function setStacks(map: Map, pictures: readonly Place[], px = STACK_BADGE_PX): void {
  map.getSource<GeoJSONSource>(STACK_SOURCE)?.setData(toStackGeoJson(findStacks(pictures, map.getZoom(), px)));
}

export function setStackVisibility(map: Map, visible: boolean): void {
  for (const id of [STACK_BADGES, STACK_COUNTS]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility(visible));
  }
}
