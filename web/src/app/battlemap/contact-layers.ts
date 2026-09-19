import type { ExpressionSpecification, GeoJSONSource, Map } from 'mapbox-gl';
import { Contact, ContactProperties, HeatField, Range, formatDtg, toGeoJson } from './contacts';

export const CONTACT_SOURCE = 'avw-contacts';
export const HEAT_LAYER = 'avw-contacts-heat';
export const POINT_LAYER = 'avw-contacts-points';

// Colours match the style guide tokens in styles.scss; Mapbox paint properties cannot read CSS variables.
const CONTACT_RED = '#c23a26';
const PAPER = '#efe7cc';

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
  visible: { heatmap: boolean; markers: boolean },
): void {
  if (!map.getSource(CONTACT_SOURCE)) {
    map.addSource(CONTACT_SOURCE, { type: 'geojson', data: toGeoJson(contacts) });
  }

  if (!map.getLayer(HEAT_LAYER)) {
    map.addLayer({
      id: HEAT_LAYER,
      type: 'heatmap',
      source: CONTACT_SOURCE,
      layout: { visibility: visible.heatmap ? 'visible' : 'none' },
      paint: {
        'heatmap-weight': heatWeight(field, range),
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 2],
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
        // Markers take over as the view closes in.
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.9, 14, 0.35],
      },
    });
  }

  if (!map.getLayer(POINT_LAYER)) {
    map.addLayer({
      id: POINT_LAYER,
      type: 'circle',
      source: CONTACT_SOURCE,
      layout: { visibility: visible.markers ? 'visible' : 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 10, 3.5, 14, 7],
        'circle-color': CONTACT_RED,
        'circle-stroke-color': PAPER,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0, 12, 1],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.55, 11, 0.95],
      },
    });
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

/**
 * The small summary shown when a marker is clicked. Built from DOM nodes rather than HTML so nothing from the data
 * can be interpreted as markup. The full incident panel replaces this later.
 */
export function contactSummaryElement(p: ContactProperties): HTMLElement {
  const root = document.createElement('div');
  root.className = 'contact-popup';

  const title = document.createElement('strong');
  title.textContent = formatDtg(p.dtg);
  root.append(title);

  const rows: [string, string][] = [
    ['Friendly force', String(p.fr)],
    ['Friendly casualties', String(p.frCas)],
    ['Enemy force', String(p.en)],
    ['Enemy casualties', String(p.enCas)],
  ];
  const list = document.createElement('dl');
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.append(dt, dd);
  }
  root.append(list);
  return root;
}
