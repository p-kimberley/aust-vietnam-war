import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Point } from 'geojson';
import type { Map } from 'maplibre-gl';
import { POI_ICON_BY_TYPE, POI_ICON_OTHER, addPoiIcons } from './poi-icons';
import { Poi, poiLabel } from './poi';

export const POI_SOURCE = 'avw-pois';
export const POI_POINTS = 'avw-pois-points';
export const POI_LABELS = 'avw-pois-labels';
export const POI_SELECTED = 'avw-pois-selected';
/** A second ring under the first that ripples out from it while the point is open, as the open incident's does. */
export const POI_HALO = 'avw-pois-selected-halo';

// Colours match the style guide tokens in styles.scss; map paint properties cannot read CSS variables.
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

/** Which icon each point is drawn with, by its type: a triangle for a fire support base, an H for a landing zone, and so on. */
const ICON_BY_TYPE: ExpressionSpecification = [
  'match',
  ['get', 'type'],
  ...Object.entries(POI_ICON_BY_TYPE).flat(),
  POI_ICON_OTHER,
] as unknown as ExpressionSpecification;

/**
 * Adds fire support bases, landing zones and the other points as icons for their type, with names from zoom 11.
 * Called after every style load and before the contact layers, so contacts always draw over these.
 */
/** The ring round the open point, by zoom; `grow` pixels further out is where its ripple has got to. */
export function poiSelectedRadius(grow = 0): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], 7, 7 + grow, 15, 15 + grow] as ExpressionSpecification;
}

export function addPoiLayers(map: Map, pois: readonly Poi[], state: { visible: boolean; selectedId: number | null }): void {
  if (!map.getSource(POI_SOURCE)) {
    map.addSource(POI_SOURCE, { type: 'geojson', data: toPoiGeoJson(pois) });
  }

  // A new style has no images, so they are added each time, ahead of the layer that names them.
  addPoiIcons(map);

  if (!map.getLayer(POI_POINTS)) {
    map.addLayer({
      id: POI_POINTS,
      type: 'symbol',
      source: POI_SOURCE,
      layout: {
        visibility: visibility(state.visible),
        'icon-image': ICON_BY_TYPE,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.55, 11, 0.85, 15, 1.15],
        // Every point is drawn, however close its neighbours, and never pushes the labels or contacts aside.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
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
        'text-offset': [0, 1.4],
        'text-optional': true,
      },
      paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 1.5 },
    });
  }

  if (!map.getLayer(POI_HALO)) {
    map.addLayer({
      id: POI_HALO,
      type: 'circle',
      source: POI_SOURCE,
      filter: selectedFilter(state.visible ? state.selectedId : null),
      paint: {
        'circle-radius': poiSelectedRadius(),
        'circle-color': SMOKE_YELLOW,
        'circle-opacity': 0,
        'circle-stroke-color': SMOKE_YELLOW,
        'circle-stroke-width': 3,
        'circle-stroke-opacity': 0,
        // Set afresh every frame, so the map is not to ease between the values as well (as it does by default).
        'circle-radius-transition': { duration: 0 },
        'circle-opacity-transition': { duration: 0 },
        'circle-stroke-opacity-transition': { duration: 0 },
      },
    });
  }

  if (!map.getLayer(POI_SELECTED)) {
    map.addLayer({
      id: POI_SELECTED,
      type: 'circle',
      source: POI_SOURCE,
      filter: selectedFilter(state.visible ? state.selectedId : null),
      paint: {
        'circle-radius': poiSelectedRadius(),
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
  if (!visible) setSelectedPoi(map, null);
}

/** Rings the point open in the panel (with its ripple), or clears the ring. */
export function setSelectedPoi(map: Map, id: number | null): void {
  for (const layer of [POI_HALO, POI_SELECTED]) {
    if (map.getLayer(layer)) map.setFilter(layer, selectedFilter(id));
  }
}
