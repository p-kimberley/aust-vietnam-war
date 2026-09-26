import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { GeoJSONSource, Map } from 'maplibre-gl';
import { Contact, HeatField, Range, SizeField, toGeoJson } from './contacts';
import { operationColourExpression } from './operation-colours';
import { POI_HALO, POI_SELECTED, poiSelectedRadius } from './poi-layers';

export const CONTACT_SOURCE = 'avw-contacts';
export const HEAT_LAYER = 'avw-contacts-heat';
export const POINT_LAYER = 'avw-contacts-points';
export const SELECTED_LAYER = 'avw-contacts-selected';
/** A second ring, under the first, that ripples out from it and fades while an incident is open (see `pulseSelection`). */
export const SELECTED_HALO = 'avw-contacts-selected-halo';

/** How far the ripple travels out from the ring, in pixels, before it has faded away. */
const HALO_TRAVEL = 26;
/** How strong the ripple is as it leaves the ring, fading to nothing as it spreads. */
const HALO_OPACITY = 0.9;
/** How strongly the ripple shades what it passes over: faintly, so the marker inside still shows. */
const HALO_FILL = 0.22;
/** How long one ripple takes: slow, so the ring breathes rather than flashes. */
export const PULSE_MS = 2400;

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
  /** Each operation's colour, when markers are coloured by operation; `null` draws them all red. */
  colours: ReadonlyMap<number, string> | null;
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

/**
 * The ring round the open incident: as before for equal markers, otherwise always clear of the scaled marker inside it. `grow`
 * pixels further out is where the ripple from it has got to (see `pulseSelection`).
 */
export function selectedRadius(sizing: MarkerSizing, grow = 0): ExpressionSpecification {
  const scale = sizeScale(sizing);
  if (!scale) {
    return ['interpolate', ['linear'], ['zoom'], 6, 6 + grow, 14, 14 + grow];
  }
  const stops = RING_ZOOMS.flatMap((zoom) => [zoom, ['max', zoom + grow, ['+', ['*', scale, baseRadius(zoom)], 4 + grow]]]);
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
        'circle-color': pointColour(state.colours),
        'circle-stroke-color': PAPER,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0, 12, 1],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.2, 10, 0.5, 12, 0.95],
      },
    });
  }

  if (!map.getLayer(SELECTED_HALO)) {
    map.addLayer({
      id: SELECTED_HALO,
      type: 'circle',
      source: CONTACT_SOURCE,
      filter: selectedFilter(state.selectedId),
      paint: {
        'circle-radius': selectedRadius(state.sizing),
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
  for (const layer of [SELECTED_HALO, SELECTED_LAYER]) {
    if (map.getLayer(layer)) {
      map.setFilter(layer, selectedFilter(id));
    }
  }
}

/**
 * Puts the ring round the open incident, and its ripple, over every other layer (the pictures, their stacks and spread-out
 * pictures are added after the contacts), so the incident being read is never hidden. After every style load, once all are added.
 */
export function raiseSelection(map: Map): void {
  for (const layer of [POI_HALO, POI_SELECTED, SELECTED_HALO, SELECTED_LAYER]) {
    if (map.getLayer(layer)) {
      map.moveLayer(layer);
    }
  }
}

/** Colours the ring round the open incident, and its ripple, to stand out on the basemap (see `selectionColour`). */
export function setSelectionColour(map: Map, colour: string): void {
  for (const layer of [SELECTED_LAYER, POI_SELECTED]) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, 'circle-stroke-color', colour);
  }
  for (const layer of [SELECTED_HALO, POI_HALO]) {
    if (map.getLayer(layer)) {
      map.setPaintProperty(layer, 'circle-stroke-color', colour);
      map.setPaintProperty(layer, 'circle-color', colour);
    }
  }
}

/**
 * Keeps the ring round the open incident pulsing, slowly, until the returned function is called: a second ring, faintly shading
 * what it passes over, leaves it and travels outward, fading as it goes, again and again. `sizing` is how the markers are sized, which the ring's size follows.
 * Nothing moves for those who ask for less motion.
 */
export function pulseSelection(map: Map, sizing: () => MarkerSizing): () => void {
  // Guarded rather than called plainly: jsdom has no matchMedia.
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return () => {};
  }
  // Drawn every frame the screen shows: at any lower rate the ripple, slowing as it spreads, visibly steps.
  let frame = 0;
  let started: number | null = null;
  // The open incident's ripple and the open point's (only one is ever open; the other's ring matches nothing).
  const halos: [string, (grow: number) => ExpressionSpecification][] = [
    [SELECTED_HALO, (grow) => selectedRadius(sizing(), grow)],
    [POI_HALO, poiSelectedRadius],
  ];
  const step = (now: number) => {
    started ??= now;
    const t = ((now - started) % PULSE_MS) / PULSE_MS;
    const eased = 1 - (1 - t) * (1 - t);                                  // out quickly, then slowing as it fades
    for (const [layer, radius] of halos) {
      if (!map.getLayer(layer)) continue;
      map.setPaintProperty(layer, 'circle-radius', radius(eased * HALO_TRAVEL));
      map.setPaintProperty(layer, 'circle-stroke-opacity', HALO_OPACITY * (1 - t * t));   // strong most of the way, then gone
      map.setPaintProperty(layer, 'circle-opacity', HALO_FILL * (1 - t));
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
    for (const [layer] of halos) {
      if (map.getLayer(layer)) {
        map.setPaintProperty(layer, 'circle-stroke-opacity', 0);
        map.setPaintProperty(layer, 'circle-opacity', 0);
      }
    }
  };
}

/** Re-weights the heatmap when the chosen data field changes. */
export function setHeatField(map: Map, field: HeatField, range: Range): void {
  if (map.getLayer(HEAT_LAYER)) {
    map.setPaintProperty(HEAT_LAYER, 'heatmap-weight', heatWeight(field, range));
  }
}

/** The markers' fill: red, or the colour of each one's operation. */
function pointColour(colours: ReadonlyMap<number, string> | null): ExpressionSpecification | string {
  return colours ? operationColourExpression(colours) : CONTACT_RED;
}

/** Colours the markers by operation, or turns them back to red. */
export function setMarkerColours(map: Map, colours: ReadonlyMap<number, string> | null): void {
  if (map.getLayer(POINT_LAYER)) {
    map.setPaintProperty(POINT_LAYER, 'circle-color', pointColour(colours));
  }
}

/** Rescales the markers, and the ring round the open incident, when the field they are sized by changes. */
export function setMarkerSizing(map: Map, sizing: MarkerSizing): void {
  if (map.getLayer(POINT_LAYER)) {
    map.setPaintProperty(POINT_LAYER, 'circle-radius', pointRadius(sizing));
    map.setLayoutProperty(POINT_LAYER, 'circle-sort-key', pointSortKey(sizing));
  }
  for (const layer of [SELECTED_HALO, SELECTED_LAYER]) {
    if (map.getLayer(layer)) {
      map.setPaintProperty(layer, 'circle-radius', selectedRadius(sizing));
    }
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
