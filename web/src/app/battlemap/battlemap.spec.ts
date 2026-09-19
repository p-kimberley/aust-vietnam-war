import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { BasemapService, MapHooks } from './basemap.service';
import { Battlemap } from './battlemap';
import { HEAT_LAYER, POINT_LAYER, SELECTED_LAYER, heatWeight } from './contact-layers';
import { Contact, ContactDetail, fieldRange, formatDtg, toGeoJson } from './contacts';
import { ContactsService } from './contacts.service';
import { MapConfig, MapConfigService, TOKEN_PLACEHOLDER, accessTokenFor, needsMapboxToken, pickBasemap } from './map-config';
import { formatAt, parseAt } from './map-url';

const contacts: Contact[] = [
  { id: 2, dtg: '1966-03-03T19:50:00', lat: 10.55, lon: 107.16, fr: 25, frCas: 0, en: 5, enCas: 0, units: [3] },
  { id: 9, dtg: '1966-03-05T08:10:00', lat: 10.61, lon: 107.2, fr: 40, frCas: 2, en: 12, enCas: 7, units: [3, 4] },
  { id: 11, dtg: '1966-04-01T00:00:00', lat: 10.7, lon: 107.3, fr: 10, frCas: 1, en: 0, enCas: 3, units: [] },
];

const detail: ContactDetail = {
  id: 2, dtg: '1966-03-03T19:50:00', lat: 10.55, lon: 107.16, gridRef: 'YS374671', operation: 'Hardihood', unitTask: null,
  units: [{ id: 3, shortName: '1 Pl, A Coy', longName: '1 Platoon, A Company' }],
  frForce: 25, enForce: 5, frKia: 1, frWia: 2, enKia: 3, enWia: 4,
  description: 'AT LOC STATED.', archivalSource: 'Intel V-dat Base', sourceUrl: null,
};

const config: MapConfig = {
  mapboxToken: 'pk.test',
  center: [107.17, 10.55],
  zoom: 8,
  basemaps: [
    { id: 'terrain', name: 'Terrain', style: 'mapbox://styles/mapbox/outdoors-v12', default: true },
    { id: 'dark', name: 'Dark', style: 'mapbox://styles/mapbox/dark-v11', default: false },
  ],
  overlays: [
    { id: 'topo', name: '1ATF topo', tiles: ['https://tiles.test/{z}/{x}/{y}.png'], tileSize: 256, attribution: null, opacity: 0.8 },
  ],
  terrain: { source: 'mapbox://mapbox.mapbox-terrain-dem-v1', exaggeration: 1.5 },
};

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
  it('reads legacy at= links, whose OpenLayers zoom is one above Mapbox', () => {
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

  it('passes a placeholder token when none is configured, since Mapbox GL renders nothing without one', () => {
    expect(accessTokenFor({ ...config, mapboxToken: 'pk.real' })).toBe('pk.real');
    expect(accessTokenFor({ ...config, mapboxToken: '' })).toBe(TOKEN_PLACEHOLDER);
    expect(accessTokenFor({ ...config, mapboxToken: null })).toBe(TOKEN_PLACEHOLDER);
  });

  it('needs a token only when something is served by Mapbox', () => {
    expect(needsMapboxToken(config)).toBe(true);
    const open: MapConfig = {
      ...config,
      basemaps: [{ id: 'osm', name: 'OSM', style: 'https://tiles.test/style.json', default: true }],
      terrain: null,
    };
    expect(needsMapboxToken(open)).toBe(false);
  });
});

/** A stand-in for the Mapbox map that records what the feature code asks of it. */
function fakeMap() {
  const sources = new Set<string>();
  const layers = new Set<string>();
  return {
    sources,
    layers,
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    addSource: vi.fn((id: string) => void sources.add(id)),
    addLayer: vi.fn((l: { id: string }) => void layers.add(l.id)),
    setFilter: vi.fn(),
    getCenter: () => ({ lat: 10.55, lng: 107.17 }),
    getZoom: () => 8,
  };
}

class FakeBasemapService {
  readonly basemapId = signal<string | undefined>('terrain');
  readonly terrainEnabled = signal(false);
  readonly overlayIds = signal<readonly string[]>([]);
  readonly map = fakeMap();
  startedWith?: unknown;
  hooks?: MapHooks;
  create = vi.fn(async (_c: HTMLElement, _cfg: MapConfig, start: unknown, hooks: MapHooks) => {
    this.startedWith = start;
    this.hooks = hooks;
    hooks.styleLoaded(this.map as never);
    return this.map as never;
  });
  setBasemap = vi.fn();
  setTerrain = vi.fn();
  setOverlay = vi.fn();
  flyTo = vi.fn();
  clickHandler?: (p: Record<string, unknown>) => void;
  bindClick = vi.fn((_layer: string, handler: (p: Record<string, unknown>) => void) => (this.clickHandler = handler));
}

async function render(opts: {
  config?: MapConfig | Error;
  contacts?: Contact[] | Error;
  inputs?: Record<string, string>;
}) {
  const basemaps = new FakeBasemapService();
  const fail = (e: Error) => Promise.reject(e);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {
        provide: MapConfigService,
        useValue: { load: () => (opts.config instanceof Error ? fail(opts.config) : Promise.resolve(opts.config ?? config)) },
      },
      {
        provide: ContactsService,
        useValue: {
          load: () => (opts.contacts instanceof Error ? fail(opts.contacts) : Promise.resolve(opts.contacts ?? contacts)),
          detail: (id: number) => Promise.resolve({ ...detail, id }),
        },
      },
    ],
  });
  TestBed.overrideComponent(Battlemap, { set: { providers: [{ provide: BasemapService, useValue: basemaps }] } });
  const fixture = TestBed.createComponent(Battlemap);
  for (const [k, v] of Object.entries(opts.inputs ?? {})) {
    fixture.componentRef.setInput(k, v);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r));
  fixture.detectChanges();
  return { fixture, basemaps, el: fixture.nativeElement as HTMLElement };
}

describe('Battlemap', () => {
  it('adds the contact layers and shows the layer panel once the map is ready', async () => {
    const { el, basemaps } = await render({});

    expect(basemaps.map.layers).toEqual(new Set([HEAT_LAYER, POINT_LAYER, SELECTED_LAYER]));
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

  it('explains a missing Mapbox token instead of showing a blank map', async () => {
    const { el, basemaps } = await render({ config: { ...config, mapboxToken: '' } });

    expect(el.querySelector('[role=alert]')?.textContent).toContain('Mapbox access token');
    expect(basemaps.create).not.toHaveBeenCalled();
  });

  it('reports a load failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { el } = await render({ contacts: new Error('boom') });

    expect(el.querySelector('[role=alert]')?.textContent).toContain('could not be loaded');
    spy.mockRestore();
  });

  it('surfaces a token rejection reported by the map', async () => {
    const { el, basemaps, fixture } = await render({});

    basemaps.hooks!.failed('Mapbox rejected the access token.');
    fixture.detectChanges();

    expect(el.querySelector('[role=alert]')?.textContent).toContain('rejected');
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
