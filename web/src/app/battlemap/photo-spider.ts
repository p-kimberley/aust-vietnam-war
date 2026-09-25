import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { PHOTO_CLUSTERS, PHOTO_COUNTS, PHOTO_IMAGES, PHOTO_POINTS } from './photo-layers';
import { PHOTO_IMAGE_PREFIX } from './photo-thumbnails';

export const SPIDER_SOURCE = 'avw-photos-spider';
export const SPIDER_LEGS_SOURCE = 'avw-photos-spider-legs';
export const SPIDER_LEGS = 'avw-photos-spider-legs';
export const SPIDER_HUB = 'avw-photos-spider-hub';
export const SPIDER_IMAGES = 'avw-photos-spider-images';
export const SPIDER_RING = 'avw-photos-spider-ring';
/** The layers a spread-out picture can be clicked on. */
export const SPIDER_CLICKABLE = [SPIDER_IMAGES] as const;

// Colours match the style guide tokens in styles.scss; map paint properties cannot read CSS variables.
const INK = '#22251a';
const PAPER = '#efe7cc';
const SMOKE_YELLOW = '#e3b92e';

/** How far apart the spread pictures sit, centre to centre, in pixels: a thumbnail and its frame, and a little air. */
export const SPIDER_SPACING_PX = 68;
/** Up to this many go round one circle; more wind out in a spiral, which keeps them apart however many there are. */
export const SPIDER_CIRCLE_MAX = 8;
/** How long the pictures take to spring out. */
export const SPIDER_SPRING_MS = 320;
/** Pictures closer together than this, in pixels, at the zoom where thumbnails show, would sit on each other there: a stack. */
export const STACK_PX = 40;
/** The zoom the stack test is measured at: where the pictures show as thumbnails and no longer group. */
const THUMBNAIL_ZOOM = 15;

type Offset = readonly [number, number];

/**
 * Where each of `count` pictures goes, as pixel offsets from the middle of the stack: evenly round a circle big enough that
 * neighbours do not touch, or, past {@link SPIDER_CIRCLE_MAX}, along a spiral from the middle, spaced evenly along its length.
 * The first starts at the top, going clockwise.
 */
export function spiderOffsets(count: number, spacing = SPIDER_SPACING_PX): Offset[] {
  if (count <= 0) {
    return [];
  }
  if (count <= SPIDER_CIRCLE_MAX) {
    const radius = Math.max(spacing * 0.9, (spacing * count) / (2 * Math.PI));
    return Array.from({ length: count }, (_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
      return [radius * Math.cos(angle), radius * Math.sin(angle)] as const;
    });
  }
  // An Archimedean spiral, r = b·θ, with its turns one spacing apart; each step moves one spacing along the curve.
  const b = spacing / (2 * Math.PI);
  const out: Offset[] = [];
  let theta = (spacing * 1.2) / b;
  for (let i = 0; i < count; i++) {
    const r = b * theta;
    out.push([r * Math.cos(theta - Math.PI / 2), r * Math.sin(theta - Math.PI / 2)]);
    theta += spacing / Math.max(r, spacing);
  }
  return out;
}

/** A spring that goes a little past where it is going and settles back: 0 at the start, 1 at the end. */
export function springOut(t: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  const u = Math.min(Math.max(t, 0), 1) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/** Whether pictures at these places would sit on each other as thumbnails: all within {@link STACK_PX} of the first, at thumbnail zoom. */
export function isStack(places: readonly { lon: number; lat: number }[]): boolean {
  if (places.length < 2) {
    return false;
  }
  const scale = (512 * 2 ** THUMBNAIL_ZOOM) / (2 * Math.PI);
  const project = (p: { lon: number; lat: number }) => {
    const lat = (Math.max(Math.min(p.lat, 85), -85) * Math.PI) / 180;
    return [scale * ((p.lon * Math.PI) / 180), scale * Math.log(Math.tan(Math.PI / 4 + lat / 2))] as const;
  };
  const [x0, y0] = project(places[0]);
  return places.every((p) => {
    const [x, y] = project(p);
    return Math.hypot(x - x0, y - y0) <= STACK_PX;
  });
}

type SpiderProperties = { id: number };
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function selectedFilter(id: number | null): ExpressionSpecification {
  return ['==', ['get', 'id'], id ?? -1];
}

/**
 * Pictures that sit on top of each other, spread out round where they are so that each can be chosen: they spring out from the
 * stack along thin legs, as full thumbnails whatever the zoom, and the stack they came from is hidden until they close up again.
 * One spread is open at a time. It closes when the map is zoomed, when the empty map is clicked, and when the pictures change.
 */
export class PhotoSpider {
  private ids: number[] = [];
  private hiddenCluster: number | null = null;
  private frame = 0;
  private selectedId: number | null = null;

  constructor(private readonly map: Map) {
    map.on('zoomstart', () => this.close());
  }

  /** The pictures spread out now, if any. */
  get open(): readonly number[] {
    return this.ids;
  }

  /** Adds the spread's layers, empty, on top of everything. Called after every style load, which drops them and anything spread. */
  addLayers(): void {
    const map = this.map;
    this.ids = [];
    this.hiddenCluster = null;
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frame);
    if (!map.getSource(SPIDER_SOURCE)) map.addSource(SPIDER_SOURCE, { type: 'geojson', data: EMPTY });
    if (!map.getSource(SPIDER_LEGS_SOURCE)) map.addSource(SPIDER_LEGS_SOURCE, { type: 'geojson', data: EMPTY });
    if (!map.getLayer(SPIDER_LEGS)) {
      map.addLayer({ id: SPIDER_LEGS, type: 'line', source: SPIDER_LEGS_SOURCE, paint: { 'line-color': INK, 'line-width': 1.5, 'line-opacity': 0.8 } });
    }
    if (!map.getLayer(SPIDER_HUB)) {
      map.addLayer({
        id: SPIDER_HUB,
        type: 'circle',
        source: SPIDER_LEGS_SOURCE,
        filter: ['==', ['get', 'hub'], true],
        paint: { 'circle-radius': 5, 'circle-color': PAPER, 'circle-stroke-color': INK, 'circle-stroke-width': 2 },
      });
    }
    if (!map.getLayer(SPIDER_RING)) {
      map.addLayer({
        id: SPIDER_RING,
        type: 'circle',
        source: SPIDER_SOURCE,
        filter: selectedFilter(this.selectedId),
        paint: { 'circle-radius': 34, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': SMOKE_YELLOW, 'circle-stroke-width': 3 },
      });
    }
    if (!map.getLayer(SPIDER_IMAGES)) {
      map.addLayer({
        id: SPIDER_IMAGES,
        type: 'symbol',
        source: SPIDER_SOURCE,
        layout: {
          'icon-image': ['concat', PHOTO_IMAGE_PREFIX, ['to-string', ['get', 'id']]],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }
  }

  /**
   * Spreads out `pictures` round `centre`. `clusterId` is the numbered disc they were grouped under, hidden while they are spread;
   * without one, the pictures' own markers are hidden. Spreading the same pictures again does nothing.
   */
  spread(centre: { lon: number; lat: number }, pictures: readonly { id: number; lon: number; lat: number }[], clusterId: number | null = null): void {
    const ids = pictures.map((p) => p.id);
    if (ids.length < 2 || (ids.length === this.ids.length && ids.every((id) => this.ids.includes(id)))) {
      return;
    }
    this.close();
    this.ids = ids;
    this.hiddenCluster = clusterId;
    this.hideOriginals();

    const map = this.map;
    const hub = map.project([centre.lon, centre.lat]);
    const offsets = spiderOffsets(ids.length);
    const draw = (k: number) => {
      const spots = offsets.map(([dx, dy]) => map.unproject([hub.x + dx * k, hub.y + dy * k]));
      const points: Feature<Point, SpiderProperties>[] = spots.map((s, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { id: ids[i] },
      }));
      const legs: Feature<LineString | Point>[] = [
        ...spots.map<Feature<LineString>>((s) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[centre.lon, centre.lat], [s.lng, s.lat]] }, properties: {} })),
        { type: 'Feature', geometry: { type: 'Point', coordinates: [centre.lon, centre.lat] }, properties: { hub: true } },
      ];
      map.getSource<GeoJSONSource>(SPIDER_SOURCE)?.setData({ type: 'FeatureCollection', features: points });
      map.getSource<GeoJSONSource>(SPIDER_LEGS_SOURCE)?.setData({ type: 'FeatureCollection', features: legs });
    };

    const still = typeof requestAnimationFrame === 'undefined' || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      draw(1);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = (now - start) / SPIDER_SPRING_MS;
      draw(springOut(t));
      if (t < 1) {
        this.frame = requestAnimationFrame(step);
      }
    };
    draw(0);
    this.frame = requestAnimationFrame(step);
  }

  /** Puts the pictures back in their stack. */
  close(): void {
    if (this.ids.length === 0) {
      return;
    }
    if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frame);
    this.ids = [];
    this.hiddenCluster = null;
    this.hideOriginals();
    this.map.getSource<GeoJSONSource>(SPIDER_SOURCE)?.setData(EMPTY);
    this.map.getSource<GeoJSONSource>(SPIDER_LEGS_SOURCE)?.setData(EMPTY);
  }

  /** Rings the open picture among the spread ones too. */
  setSelected(id: number | null): void {
    this.selectedId = id;
    if (this.map.getLayer(SPIDER_RING)) this.map.setFilter(SPIDER_RING, selectedFilter(id));
  }

  /** Hides the markers of the spread pictures (or their group's disc) where they were, or shows them all again. */
  private hideOriginals(): void {
    const map = this.map;
    const single: ExpressionSpecification = ['!', ['has', 'point_count']];
    const markers: ExpressionSpecification = this.ids.length ? ['all', single, ['!', ['in', ['get', 'id'], ['literal', this.ids]]]] : single;
    const group: ExpressionSpecification =
      this.hiddenCluster !== null ? ['all', ['has', 'point_count'], ['!=', ['get', 'cluster_id'], this.hiddenCluster]] : ['has', 'point_count'];
    for (const id of [PHOTO_POINTS, PHOTO_IMAGES]) if (map.getLayer(id)) map.setFilter(id, markers);
    for (const id of [PHOTO_CLUSTERS, PHOTO_COUNTS]) if (map.getLayer(id)) map.setFilter(id, group);
  }
}
