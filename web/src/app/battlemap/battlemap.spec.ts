import { describe, expect, it, vi } from 'vitest';
import { config, contacts, render } from './battlemap-testing';
import { HEAT_LAYER, POINT_LAYER, SELECTED_LAYER, heatWeight } from './contact-layers';
import { fieldRange, formatDtg, toGeoJson } from './contacts';
import { MapConfig, pickBasemap } from './map-config';
import { formatAt, parseAt } from './map-url';

describe('contacts', () => {
  it('converts contacts to GeoJSON with [lon, lat] coordinates and the id as feature id', () => {
    const fc = toGeoJson(contacts);
    expect(fc.features).toHaveLength(3);
    expect(fc.features[1].geometry.coordinates).toEqual([107.2, 10.61]);
    expect(fc.features[1].id).toBe(9);
    expect(fc.features[1].properties).toEqual({ id: 9, dtg: '1966-03-05T08:10:00', fr: 40, frCas: 2, en: 12, enCas: 7 });
  });

  it('finds the range of a field, and copes with no data', () => {
    expect(fieldRange(contacts, 'enCas')).toEqual({ min: 0, max: 7 });
    expect(fieldRange([], 'fr')).toEqual({ min: 0, max: 0 });
  });

  it('formats a DTG as recorded, whatever the visitor time zone', () => {
    expect(formatDtg('1966-03-03T19:50:00')).toBe('3 Mar 1966 19:50');
    expect(formatDtg('1966-03-03')).toBe('3 Mar 1966');
    expect(formatDtg('nonsense')).toBe('nonsense');
  });
});

describe('heatWeight', () => {
  it('normalises over the data range', () => {
    expect(heatWeight('fr', { min: 10, max: 40 })).toEqual(['interpolate', ['linear'], ['get', 'fr'], 10, 0, 40, 1]);
  });

  it('avoids a degenerate scale when every value is equal', () => {
    expect(heatWeight('fr', { min: 5, max: 5 })).toBe(0.5);
  });
});

describe('map URL state', () => {
  it('reads legacy at= links, whose OpenLayers zoom is one above MapLibre GL', () => {
    expect(parseAt('10.55,107.17,10')).toEqual({ lat: 10.55, lon: 107.17, zoom: 9 });
  });

  it('round-trips through formatAt so old and new links agree', () => {
    const camera = { lat: 10.55123, lon: 107.17456, zoom: 8.5 };
    expect(parseAt(formatAt(camera))).toEqual(camera);
    expect(formatAt(camera)).toBe('10.55123,107.17456,9.5');
  });

  it.each(['', 'abc', '10,107', '10,107,x', '95,107,5', '10,190,5', '10,107,0', '10,107,40'])('rejects %j', (bad) => {
    expect(parseAt(bad)).toBeNull();
  });

  it('ignores a missing value', () => {
    expect(parseAt(undefined)).toBeNull();
  });
});

describe('map config helpers', () => {
  it('prefers the requested basemap, then the default, then the first', () => {
    expect(pickBasemap(config, 'dark')?.id).toBe('dark');
    expect(pickBasemap(config, 'gone')?.id).toBe('terrain');
    expect(pickBasemap({ ...config, basemaps: [{ ...config.basemaps[1] }] }, null)?.id).toBe('dark');
    expect(pickBasemap({ ...config, basemaps: [] })).toBeUndefined();
  });
});

describe('Battlemap', () => {
  it('adds the contact layers and shows the layer panel once the map is ready', async () => {
    const { el, basemaps } = await render({});

    expect([...basemaps.map.layers]).toEqual(expect.arrayContaining([HEAT_LAYER, POINT_LAYER, SELECTED_LAYER]));
    expect(el.querySelector('.bm__count')?.textContent).toContain('3 contacts');
    expect([...el.querySelectorAll('input[name=basemap]')]).toHaveLength(2);
    expect(el.textContent).toContain('3D terrain');
    expect(el.textContent).toContain('1ATF topo');
  });

  it('starts from the view in the URL', async () => {
    const { basemaps } = await render({
      inputs: { at: '10.6,107.2,11', basemap: 'dark', terrain: '1', overlays: 'topo' },
    });

    expect(basemaps.startedWith).toEqual({
      basemapId: 'dark',
      camera: { lat: 10.6, lon: 107.2, zoom: 10 },
      terrain: true,
      overlays: ['topo'],
    });
  });

  it('passes the chosen basemap through to the map', async () => {
    const { el, basemaps, fixture } = await render({});

    const dark = el.querySelectorAll<HTMLInputElement>('input[name=basemap]')[1];
    dark.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(basemaps.setBasemap).toHaveBeenCalledWith('dark');
  });

  it('hides the terrain switch when the deployment has no terrain source', async () => {
    const { el } = await render({ config: { ...config, terrain: null } });
    expect(el.textContent).not.toContain('3D terrain');
  });

  it('reports a load failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { el } = await render({ contacts: new Error('boom') });

    expect(el.querySelector('[role=alert]')?.textContent).toContain('could not be loaded');
    spy.mockRestore();
  });

  it('surfaces a basemap failure reported by the map', async () => {
    const { el, basemaps, fixture } = await render({});

    basemaps.hooks!.failed('The basemap style could not be loaded (404).');
    fixture.detectChanges();

    expect(el.querySelector('[role=alert]')?.textContent).toContain('basemap style');
  });

  it('opens the incident panel when a marker is clicked, and rings it on the map', async () => {
    const { el, basemaps, fixture } = await render({});
    expect(el.querySelector('app-incident-panel')).toBeNull();

    basemaps.clickHandler!({ id: 9 });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('app-incident-panel')).not.toBeNull();
    expect(basemaps.map.setFilter).toHaveBeenCalledWith(SELECTED_LAYER, ['==', ['get', 'id'], 9]);
  });

  it('closes the incident panel and clears the ring', async () => {
    const { el, basemaps, fixture } = await render({ inputs: { incident: '2' } });
    await fixture.whenStable();
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('.incident__close')!.click();
    fixture.detectChanges();

    expect(el.querySelector('app-incident-panel')).toBeNull();
    expect(basemaps.map.setFilter).toHaveBeenLastCalledWith(SELECTED_LAYER, ['==', ['get', 'id'], -1]);
  });

  it('opens straight onto an incident from the link and frames it when the link has no view', async () => {
    const { el, basemaps } = await render({ inputs: { incident: '9' } });

    expect(el.querySelector('app-incident-panel')).not.toBeNull();
    expect(basemaps.flyTo).toHaveBeenCalledWith(10.61, 107.2, 11);
  });

  it('keeps the view from the link rather than jumping to the incident', async () => {
    const { basemaps } = await render({ inputs: { incident: '9', at: '10.6,107.2,11' } });
    expect(basemaps.flyTo).not.toHaveBeenCalled();
  });

  it.each(['abc', '99999', '-1', '2.5'])('ignores an incident link that is not a real contact (%s)', async (bad) => {
    const { el, basemaps } = await render({ inputs: { incident: bad } });

    expect(el.querySelector('app-incident-panel')).toBeNull();
    expect(basemaps.flyTo).not.toHaveBeenCalled();
  });
});
