import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { IncidentMediaView } from './community/community';
import { STACK_BADGE_PX, addStackLayers, setStackVisibility, setStacks } from './photo-stacks';
import { PHOTO_IMAGE_PREFIX, registerPhotoThumbnails } from './photo-thumbnails';

export const PHOTO_SOURCE = 'avw-photos';
export const PHOTO_CLUSTERS = 'avw-photos-clusters';
export const PHOTO_COUNTS = 'avw-photos-counts';
export const PHOTO_POINTS = 'avw-photos-points';
export const PHOTO_IMAGES = 'avw-photos-images';
export const PHOTO_SELECTED = 'avw-photos-selected';

// Colours match the style guide tokens in styles.scss; map paint properties cannot read CSS variables.
const INK = '#22251a';
const PAPER = '#efe7cc';
const KHAKI = '#e6ddb8';
const SMOKE_YELLOW = '#e3b92e';

/** The thumbnails start to fade in at this zoom, and are fully there one level later, where the pictures no longer group. */
export const PHOTO_FADE_START = 14;
export const PHOTO_FULL_ZOOM = 15;
/** From this zoom the thumbnails grow with the zoom, in a straight line: this much of their size again for each level. */
export const PHOTO_GROW_FROM = 18;
export const PHOTO_GROWTH_PER_ZOOM = 0.5;
const MAX_ZOOM = 22;

/** The ring round the open picture, at the sizes the thumbnails are, so it goes round the thumbnail and not behind it. */
const RING_AT_FULL_SIZE = 34;

/** How many times its usual size a thumbnail is at a zoom: 1 up to zoom 18, then growing steadily. */
export function thumbnailScale(zoom: number): number {
  return zoom <= PHOTO_GROW_FROM ? 1 : 1 + (zoom - PHOTO_GROW_FROM) * PHOTO_GROWTH_PER_ZOOM;
}

/** How big a thumbnail is drawn at each zoom: its usual size to zoom 18, then growing. Spread-out pictures use it too. */
export const PHOTO_IMAGE_SIZE: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], PHOTO_GROW_FROM, 1, MAX_ZOOM, thumbnailScale(MAX_ZOOM)];
const IMAGE_SIZE = PHOTO_IMAGE_SIZE;
/** The ring round an open thumbnail at each zoom, once thumbnails are fully shown: it grows with them. */
export const PHOTO_THUMBNAIL_RING: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  PHOTO_GROW_FROM,
  RING_AT_FULL_SIZE,
  MAX_ZOOM,
  RING_AT_FULL_SIZE * thumbnailScale(MAX_ZOOM),
];
/** The thumbnail fades in as the plain marker under it fades out, so the one turns into the other. */
const IMAGE_OPACITY: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], PHOTO_FADE_START, 0, PHOTO_FULL_ZOOM, 1];
const DOT_OPACITY: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], PHOTO_FADE_START, 1, PHOTO_FULL_ZOOM, 0];
const RING_RADIUS: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  9,
  PHOTO_FADE_START,
  14,
  PHOTO_FULL_ZOOM,
  RING_AT_FULL_SIZE,
  PHOTO_GROW_FROM,
  RING_AT_FULL_SIZE,
  MAX_ZOOM,
  RING_AT_FULL_SIZE * thumbnailScale(MAX_ZOOM),
];

type PhotoProperties = { id: number };

/** The pictures that have a place, as map features. A picture without one is left out. */
export function toPhotoGeoJson(pictures: readonly IncidentMediaView[]): FeatureCollection<Point, PhotoProperties> {
  const features: Feature<Point, PhotoProperties>[] = [];
  for (const p of pictures) {
    if (p.lat !== null && p.lon !== null) {
      features.push({ type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { id: p.id } });
    }
  }
  return { type: 'FeatureCollection', features };
}

function selectedFilter(id: number | null): ExpressionSpecification {
  return ['==', ['get', 'id'], id ?? -1];
}

const visibility = (visible: boolean) => (visible ? 'visible' : 'none');

/**
 * Adds the community pictures: a marker for each one, grouped into a numbered disc where they crowd together, then the pictures
 * themselves as thumbnails from zoom 14, fading in as the marker fades out and fully there at 15, and a ring round the one open
 * in the panel. Called after every style load and after the contact layers, so these draw on top: there are few of them, and
 * hiding one under a contact marker would hide it altogether.
 */
export function addPhotoLayers(map: Map, pictures: readonly IncidentMediaView[], state: { visible: boolean; selectedId: number | null }): void {
  if (!map.getSource(PHOTO_SOURCE)) {
    // Groups break up by zoom 14, where the thumbnails begin to show.
    map.addSource(PHOTO_SOURCE, { type: 'geojson', data: toPhotoGeoJson(pictures), cluster: true, clusterRadius: 36, clusterMaxZoom: PHOTO_FADE_START - 1 });
  }
  registerPhotoThumbnails(map, pictures);

  if (!map.getLayer(PHOTO_CLUSTERS)) {
    map.addLayer({
      id: PHOTO_CLUSTERS,
      type: 'circle',
      source: PHOTO_SOURCE,
      filter: ['has', 'point_count'],
      layout: { visibility: visibility(state.visible) },
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 13, 10, 17, 50, 21],
        'circle-color': KHAKI,
        'circle-stroke-color': INK,
        'circle-stroke-width': 2,
      },
    });
  }

  if (!map.getLayer(PHOTO_COUNTS)) {
    map.addLayer({
      id: PHOTO_COUNTS,
      type: 'symbol',
      source: PHOTO_SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        visibility: visibility(state.visible),
        'text-field': ['get', 'point_count_abbreviated'],
        // A face that every style's glyph set already has; the vintage faces may not be installed everywhere.
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': INK },
    });
  }

  if (!map.getLayer(PHOTO_POINTS)) {
    map.addLayer({
      id: PHOTO_POINTS,
      type: 'circle',
      source: PHOTO_SOURCE,
      filter: ['!', ['has', 'point_count']],
      layout: { visibility: visibility(state.visible) },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 15, 8],
        'circle-color': PAPER,
        'circle-stroke-color': INK,
        'circle-stroke-width': 2.5,
        'circle-opacity': DOT_OPACITY,
        'circle-stroke-opacity': DOT_OPACITY,
      },
    });
  }

  if (!map.getLayer(PHOTO_IMAGES)) {
    map.addLayer({
      id: PHOTO_IMAGES,
      type: 'symbol',
      source: PHOTO_SOURCE,
      // Below this zoom there is nothing to draw, and no thumbnail is fetched.
      minzoom: PHOTO_FADE_START,
      filter: ['!', ['has', 'point_count']],
      layout: {
        visibility: visibility(state.visible),
        'icon-image': ['concat', PHOTO_IMAGE_PREFIX, ['to-string', ['get', 'id']]],
        'icon-size': IMAGE_SIZE,
        // Every picture is drawn, however close its neighbours.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': IMAGE_OPACITY },
    });
  }

  if (!map.getLayer(PHOTO_SELECTED)) {
    map.addLayer({
      id: PHOTO_SELECTED,
      type: 'circle',
      source: PHOTO_SOURCE,
      filter: selectedFilter(state.visible ? state.selectedId : null),
      paint: {
        'circle-radius': RING_RADIUS,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': SMOKE_YELLOW,
        'circle-stroke-width': 3,
      },
    });
  }

  // Over the thumbnails: the number of pictures in each stack, on its corner.
  addStackLayers(map, state.visible);
}

/** The pictures that have a place, with it. */
function placed(pictures: readonly IncidentMediaView[]): { id: number; lon: number; lat: number }[] {
  return pictures.filter((p) => p.lat !== null && p.lon !== null).map((p) => ({ id: p.id, lon: p.lon!, lat: p.lat! }));
}

/** Works out again which pictures lie on top of each other, for the badges: after a zoom, or when the pictures change. */
export function refreshStacks(map: Map, pictures: readonly IncidentMediaView[]): void {
  // Bigger thumbnails hide more of each other, so what counts as a stack grows with them.
  setStacks(map, placed(pictures), STACK_BADGE_PX * thumbnailScale(map.getZoom()));
}

export function setPhotoVisibility(map: Map, visible: boolean): void {
  for (const id of [PHOTO_CLUSTERS, PHOTO_COUNTS, PHOTO_POINTS, PHOTO_IMAGES]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility(visible));
  }
  setStackVisibility(map, visible);
  if (!visible && map.getLayer(PHOTO_SELECTED)) map.setFilter(PHOTO_SELECTED, selectedFilter(null));
}

/** Rings the picture open in the panel, or clears the ring. (A picture inside a group is ringed once the group opens out.) */
export function setSelectedPhoto(map: Map, id: number | null): void {
  if (map.getLayer(PHOTO_SELECTED)) map.setFilter(PHOTO_SELECTED, selectedFilter(id));
}

/** Zooms in on a group of pictures far enough that it breaks up, centred where it was clicked. */
export async function zoomIntoCluster(map: Map, clusterId: number, at: { lon: number; lat: number }): Promise<void> {
  const source = map.getSource<GeoJSONSource>(PHOTO_SOURCE);
  if (!source) return;
  const zoom = await source.getClusterExpansionZoom(clusterId);
  map.easeTo({ center: [at.lon, at.lat], zoom: zoom + 0.5, duration: 600 });
}

/** Puts a new set of pictures on the map (after one is added), keeping the thumbnails of those already known. */
export function setPhotos(map: Map, pictures: readonly IncidentMediaView[]): void {
  registerPhotoThumbnails(map, pictures);
  map.getSource<GeoJSONSource>(PHOTO_SOURCE)?.setData(toPhotoGeoJson(pictures));
  refreshStacks(map, pictures);
}

/** The pictures grouped under a numbered disc, with their places. */
export async function clusterPictures(map: Map, clusterId: number): Promise<{ id: number; lon: number; lat: number }[]> {
  const source = map.getSource<GeoJSONSource>(PHOTO_SOURCE);
  if (!source) return [];
  const leaves = await source.getClusterLeaves(clusterId, Infinity, 0);
  return leaves.map((f) => {
    const [lon, lat] = (f.geometry as Point).coordinates;
    return { id: Number(f.properties?.['id']), lon, lat };
  });
}
