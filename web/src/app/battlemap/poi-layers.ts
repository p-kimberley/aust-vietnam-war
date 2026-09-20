import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { Map } from 'maplibre-gl';
import { Poi, poiLabel } from './poi';

export const POI_SOURCE = 'avw-pois';
export const POI_POINTS = 'avw-pois-points';
export const POI_LABELS = 'avw-pois-labels';
export const POI_SELECTED = 'avw-pois-selected';

// Colours match the style guide tokens in styles.scss; map paint properties cannot read CSS variables.
const BRASS = '#c99a3b';
const FRIENDLY_BLUE = '#2f5f86';
const INK = '#22251a';
const PAPER = '#efe7cc';
const SMOKE_YELLOW = '#e3b92e';

export function toPoiGeoJson(pois: readonly Poi[]): FeatureCollection<Point, { id: number; type: string; label: string }> {
  const features: Feature<Point, { id: number; type: string; label: string }>[] = pois.map((p) => ({
    type: 'Feature',
    id: p.id,
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: { id: p.id, type: p.type, label: poiLabel(p) },
  }));
  return { type: 'FeatureCollection', features };
}

function selectedFilter(id: number | null): ExpressionSpecification {
  return ['==', ['get', 'id'], id ?? -1];
}

const visibility = (visible: boolean) => (visible ? 'visible' : 'none');

/**
 * Adds fire support bases and landing zones as brass markers (blue for landing zones) with names from zoom 11. Called
 * after every style load and before the contact layers, so contacts always draw over these.
 */
export function addPoiLayers(map: Map, pois: readonly Poi[], state: { visible: boolean; selectedId: number | null }): void {
  if (!map.getSource(POI_SOURCE)) {
    map.addSource(POI_SOURCE, { type: 'geojson', data: toPoiGeoJson(pois) });
  }

  if (!map.getLayer(POI_POINTS)) {
    map.addLayer({
      id: POI_POINTS,
      type: 'circle',
      source: POI_SOURCE,
      layout: { visibility: visibility(state.visible) },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 11, 5, 15, 8],
        'circle-color': ['match', ['get', 'type'], 'LZ', FRIENDLY_BLUE, BRASS],
        'circle-stroke-color': INK,
        'circle-stroke-width': 1.2,
      },
    });
  }

  if (!map.getLayer(POI_LABELS)) {
    map.addLayer({
      id: POI_LABELS,
      type: 'symbol',
      source: POI_SOURCE,
      minzoom: 11,
      layout: {
        visibility: visibility(state.visible),
        'text-field': ['get', 'label'],
        // A face that every style's glyph set already has; the vintage faces may not be installed everywhere.
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13],
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-optional': true,
      },
      paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 1.5 },
    });
  }

  if (!map.getLayer(POI_SELECTED)) {
    map.addLayer({
      id: POI_SELECTED,
      type: 'circle',
      source: POI_SOURCE,
      filter: selectedFilter(state.visible ? state.selectedId : null),
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 7, 15, 15],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': SMOKE_YELLOW,
        'circle-stroke-width': 3,
      },
    });
  }
}

export function setPoiVisibility(map: Map, visible: boolean): void {
  for (const id of [POI_POINTS, POI_LABELS]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility(visible));
  }
  if (!visible && map.getLayer(POI_SELECTED)) map.setFilter(POI_SELECTED, selectedFilter(null));
}

/** Rings the point open in the panel, or clears the ring. */
export function setSelectedPoi(map: Map, id: number | null): void {
  if (map.getLayer(POI_SELECTED)) map.setFilter(POI_SELECTED, selectedFilter(id));
}
