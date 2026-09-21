import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { Contact, HeatField, Range, SizeField, toGeoJson } from './contacts';

export const CONTACT_SOURCE = 'avw-contacts';
export const HEAT_LAYER = 'avw-contacts-heat';
export const POINT_LAYER = 'avw-contacts-points';
export const SELECTED_LAYER = 'avw-contacts-selected';

// Colours match the style guide tokens in styles.scss; map paint properties cannot read CSS variables.
const CONTACT_RED = '#c23a26';
const PAPER = '#efe7cc';
const SMOKE_YELLOW = '#e3b92e';

/** How markers are scaled. A `field` of null draws every marker the same size. */
export interface MarkerSizing {
  field: SizeField | null;
  /** The value at which a marker reaches its largest size (see `sizeCap`). */
  cap: number;
}

export interface ContactLayerState {
  heatmap: boolean;
  markers: boolean;
  /** The incident open in the panel, ringed on the map. */
  selectedId: number | null;
  sizing: MarkerSizing;
}

/** Marker radius in pixels at each zoom when every marker is the same size. */
const POINT_RADIUS: readonly (readonly [zoom: number, px: number])[] = [
  [7, 0.8],
  [10, 2.5],
  [12, 5],
  [14, 8],
];
const RING_ZOOMS = [6, 7, 10, 12, 14] as const;
/** The radius multiplier for a marker with none recorded, and for one at the cap. */
const SMALLEST_SCALE = 0.6;
const LARGEST_SCALE = 3;

/** The unscaled marker radius at `zoom`, for keeping the selection ring clear of a scaled marker. */
function baseRadius(zoom: number): number {
  const [first] = POINT_RADIUS;
  if (zoom <= first[0]) {
    return first[1];
  }
  for (let i = 1; i < POINT_RADIUS.length; i++) {
    const [z0, r0] = POINT_RADIUS[i - 1];
    const [z1, r1] = POINT_RADIUS[i];
    if (zoom <= z1) {
      return r0 + ((r1 - r0) * (zoom - z0)) / (z1 - z0);
    }
  }
  return POINT_RADIUS[POINT_RADIUS.length - 1][1];
}

/**
 * The per-marker radius multiplier, or null when markers are all one size. It grows with the square root of the
 * value, so a marker's area follows the count, and stops growing at the cap.
 */
function sizeScale({ field, cap }: MarkerSizing): ExpressionSpecification | null {
  if (!field || cap <= 0) {
    return null;
  }
  return ['interpolate', ['linear'], ['sqrt', ['get', field]], 0, SMALLEST_SCALE, Math.sqrt(cap), LARGEST_SCALE] as ExpressionSpecification;
}

/** The marker radius, by zoom and, when a field is chosen, by that field's value. */
export function pointRadius(sizing: MarkerSizing): ExpressionSpecification {
  const scale = sizeScale(sizing);
  const stops = POINT_RADIUS.flatMap(([zoom, px]) => [zoom, scale ? ['*', scale, px] : px]);
  return ['interpolate', ['linear'], ['zoom'], ...stops] as ExpressionSpecification;
}

/** The ring round the open incident: as before for equal markers, otherwise always clear of the scaled marker inside it. */
export function selectedRadius(sizing: MarkerSizing): ExpressionSpecification {
  const scale = sizeScale(sizing);
  if (!scale) {
    return ['interpolate', ['linear'], ['zoom'], 6, 6, 14, 14];
  }
  const stops = RING_ZOOMS.flatMap((zoom) => [zoom, ['max', zoom, ['+', ['*', scale, baseRadius(zoom)], 4]]]);
  return ['interpolate', ['linear'], ['zoom'], ...stops] as ExpressionSpecification;
}

/** Larger markers are drawn first, so smaller ones inside or beside them stay visible and clickable. */
function pointSortKey({ field, cap }: MarkerSizing): ExpressionSpecification | number {
  return field && cap > 0 ? (['-', ['get', field]] as ExpressionSpecification) : 0;
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
      layout: { visibility: state.markers ? 'visible' : 'none', 'circle-sort-key': pointSortKey(state.sizing) },
      paint: {
        'circle-radius': pointRadius(state.sizing),
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
        'circle-radius': selectedRadius(state.sizing),
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

/** Rescales the markers, and the ring round the open incident, when the field they are sized by changes. */
export function setMarkerSizing(map: Map, sizing: MarkerSizing): void {
  if (map.getLayer(POINT_LAYER)) {
    map.setPaintProperty(POINT_LAYER, 'circle-radius', pointRadius(sizing));
    map.setLayoutProperty(POINT_LAYER, 'circle-sort-key', pointSortKey(sizing));
  }
  if (map.getLayer(SELECTED_LAYER)) {
    map.setPaintProperty(SELECTED_LAYER, 'circle-radius', selectedRadius(sizing));
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
