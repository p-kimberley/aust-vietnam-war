import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { IncidentMediaView } from './community/community';

export const PHOTO_SOURCE = 'avw-photos';
export const PHOTO_CLUSTERS = 'avw-photos-clusters';
export const PHOTO_COUNTS = 'avw-photos-counts';
export const PHOTO_POINTS = 'avw-photos-points';
export const PHOTO_SELECTED = 'avw-photos-selected';

// Colours match the style guide tokens in styles.scss; map paint properties cannot read CSS variables.
const INK = '#22251a';
const PAPER = '#efe7cc';
const KHAKI = '#e6ddb8';
const SMOKE_YELLOW = '#e3b92e';

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
 * Adds the community pictures: a print-like marker for each one, grouped into a numbered disc where they crowd together, and a
 * ring round the one open in the panel. Called after every style load and after the contact layers, so these draw on top:
 * there are few of them, and hiding one under a contact marker would hide it altogether.
 */
export function addPhotoLayers(map: Map, pictures: readonly IncidentMediaView[], state: { visible: boolean; selectedId: number | null }): void {
  if (!map.getSource(PHOTO_SOURCE)) {
    map.addSource(PHOTO_SOURCE, { type: 'geojson', data: toPhotoGeoJson(pictures), cluster: true, clusterRadius: 36, clusterMaxZoom: 14 });
  }

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
      },
    });
  }

  if (!map.getLayer(PHOTO_SELECTED)) {
    map.addLayer({
      id: PHOTO_SELECTED,
      type: 'circle',
      source: PHOTO_SOURCE,
      filter: selectedFilter(state.visible ? state.selectedId : null),
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 9, 15, 14],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': SMOKE_YELLOW,
        'circle-stroke-width': 3,
      },
    });
  }
}

export function setPhotoVisibility(map: Map, visible: boolean): void {
  for (const id of [PHOTO_CLUSTERS, PHOTO_COUNTS, PHOTO_POINTS]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility(visible));
  }
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
