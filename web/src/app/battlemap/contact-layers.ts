import type { ExpressionSpecification, GeoJSONSource, Map } from 'mapbox-gl';
import { Contact, HeatField, Range, toGeoJson } from './contacts';

export const CONTACT_SOURCE = 'avw-contacts';
export const HEAT_LAYER = 'avw-contacts-heat';
export const POINT_LAYER = 'avw-contacts-points';
export const SELECTED_LAYER = 'avw-contacts-selected';

// Colours match the style guide tokens in styles.scss; Mapbox paint properties cannot read CSS variables.
const CONTACT_RED = '#c23a26';
const PAPER = '#efe7cc';
const SMOKE_YELLOW = '#e3b92e';

export interface ContactLayerState {
  heatmap: boolean;
  markers: boolean;
  /** The incident open in the panel, ringed on the map. */
  selectedId: number | null;
}

/** Matches nothing when no incident is selected. */
function selectedFilter(id: number | null): ExpressionSpecification {
  return ['==', ['get', 'id'], id ?? -1];
}

/** A heatmap weight in 0..1 for `field`, normalised over the data's range so the scale never saturates. */
export function heatWeight(field: HeatField, range: Range): ExpressionSpecification | number {
  if (range.max <= range.min) {
    return 0.5;
  }
  return ['interpolate', ['linear'], ['get', field], range.min, 0, range.max, 1] as ExpressionSpecification;
}

/**
 * Adds the contact source and its two layers: a heatmap for the overview and circle markers for individual
 * incidents. Called after every style load, because switching basemap discards custom sources and layers.
 */
export function addContactLayers(
  map: Map,
  contacts: readonly Contact[],
  field: HeatField,
  range: Range,
  state: ContactLayerState,
): void {
  if (!map.getSource(CONTACT_SOURCE)) {
    map.addSource(CONTACT_SOURCE, { type: 'geojson', data: toGeoJson(contacts) });
  }

  if (!map.getLayer(HEAT_LAYER)) {
    map.addLayer({
      id: HEAT_LAYER,
      type: 'heatmap',
      source: CONTACT_SOURCE,
      layout: { visibility: state.heatmap ? 'visible' : 'none' },
      paint: {
        'heatmap-weight': heatWeight(field, range),
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 6, 0.9, 12, 2.4],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 6, 8, 10, 22, 14, 40],
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, 'rgba(230,221,184,0)',
          0.2, 'rgba(230,221,184,0.55)',
          0.45, 'rgba(227,185,46,0.75)',
          0.7, 'rgba(217,130,43,0.85)',
          1, 'rgba(194,58,38,0.95)',
        ],
        // Markers are faint and small zoomed out, so the heatmap carries the overview; they take over as the view closes in.
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.95, 14, 0.3],
      },
    });
  }

  if (!map.getLayer(POINT_LAYER)) {
    map.addLayer({
      id: POINT_LAYER,
      type: 'circle',
      source: CONTACT_SOURCE,
      layout: { visibility: state.markers ? 'visible' : 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 10, 2.5, 12, 5, 14, 8],
        'circle-color': CONTACT_RED,
        'circle-stroke-color': PAPER,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0, 12, 1],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.2, 10, 0.5, 12, 0.95],
      },
    });
  }

  if (!map.getLayer(SELECTED_LAYER)) {
    map.addLayer({
      id: SELECTED_LAYER,
      type: 'circle',
      source: CONTACT_SOURCE,
      filter: selectedFilter(state.selectedId),
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 6, 14, 14],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': SMOKE_YELLOW,
        'circle-stroke-width': 3,
      },
    });
  }
}

/** Rings the incident open in the panel, or clears the ring. */
export function setSelectedContact(map: Map, id: number | null): void {
  if (map.getLayer(SELECTED_LAYER)) {
    map.setFilter(SELECTED_LAYER, selectedFilter(id));
  }
}

/** Re-weights the heatmap when the chosen data field changes. */
export function setHeatField(map: Map, field: HeatField, range: Range): void {
  if (map.getLayer(HEAT_LAYER)) {
    map.setPaintProperty(HEAT_LAYER, 'heatmap-weight', heatWeight(field, range));
  }
}

export function setContactVisibility(map: Map, layer: typeof HEAT_LAYER | typeof POINT_LAYER, visible: boolean): void {
  if (map.getLayer(layer)) {
    map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
  }
}

/** Replaces the plotted contacts, for example after a filter changes. */
export function setContacts(map: Map, contacts: readonly Contact[]): void {
  (map.getSource(CONTACT_SOURCE) as GeoJSONSource | undefined)?.setData(toGeoJson(contacts));
}
