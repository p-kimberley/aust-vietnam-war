import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { arrive, config, contacts, render, settle } from './battlemap-testing';
import { HEAT_LAYER, POINT_LAYER, PULSE_MS, SELECTED_HALO, SELECTED_LAYER, heatWeight, pointRadius, pulseSelection, selectedRadius } from './contact-layers';
import { fieldRange, formatDtg, sizeCap, toGeoJson } from './contacts';
import { parseOverlayOpacities } from './basemap.service';
import { MapConfig, basemapStyle, pickBasemap } from './map-config';
import { formatAt, parseAt } from './map-url';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('contacts', () => {
  it('converts contacts to GeoJSON with [lon, lat] coordinates and the id as feature id', () => {
    const fc = toGeoJson(contacts);
    expect(fc.features).toHaveLength(3);
    expect(fc.features[1].geometry.coordinates).toEqual([107.2, 10.61]);
    expect(fc.features[1].id).toBe(9);
    expect(fc.features[1].properties).toEqual({ id: 9, dtg: '1966-03-05T08:10:00', op: 0, fr: 40, frCas: 2, en: 12, enCas: 7, frKia: 1, frWia: 1, enKia: 5, enWia: 2 });
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

describe('marker sizing', () => {
  const equalSizes = ['interpolate', ['linear'], ['zoom'], 7, 0.8, 10, 2.5, 12, 5, 14, 8];

  it('reaches the largest size at the 95th percentile of the recorded values, so one huge engagement does not shrink the rest', () => {
    const values = [...Array.from({ length: 99 }, (_, i) => i + 1), 1000];
    const all = values.map((enKia, id) => ({ ...contacts[0], id, enKia }));
    expect(sizeCap(all, 'enKia')).toBe(96);
  });

  it('ignores contacts with none recorded, and has no cap when nothing is recorded', () => {
    expect(sizeCap([{ ...contacts[0], frKia: 0 }, { ...contacts[0], frKia: 0 }, { ...contacts[0], frKia: 3 }], 'frKia')).toBe(3);
    expect(sizeCap([contacts[0]], 'frKia')).toBe(0);
    expect(sizeCap([], 'fr')).toBe(0);
  });

  it('draws every marker as it always was when no field is chosen, or the chosen one is never recorded', () => {
    expect(pointRadius({ field: null, cap: 0 })).toEqual(equalSizes);
    expect(pointRadius({ field: 'enWia', cap: 0 })).toEqual(equalSizes);
    expect(selectedRadius({ field: null, cap: 0 })).toEqual(['interpolate', ['linear'], ['zoom'], 6, 6, 14, 14]);
  });

  it('scales the radius with the square root of the value, from 0.6 for none to 3 at the cap', () => {
    const scale = ['interpolate', ['linear'], ['sqrt', ['get', 'frKia']], 0, 0.6, 2, 3];
    const radius = pointRadius({ field: 'frKia', cap: 4 }) as unknown[];
    expect(radius.slice(0, 5)).toEqual(['interpolate', ['linear'], ['zoom'], 7, ['*', scale, 0.8]]);
    expect(radius.at(-1)).toEqual(['*', scale, 8]);
  });

  it('keeps the ring round the open incident outside its scaled marker', () => {
    const scale = ['interpolate', ['linear'], ['sqrt', ['get', 'fr']], 0, 0.6, 10, 3];
    const ring = selectedRadius({ field: 'fr', cap: 100 }) as unknown[];
    expect(ring.at(-1)).toEqual(['max', 14, ['+', ['*', scale, 8], 4]]);
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

  it('reads overlay opacities as id:value pairs, ignoring anything out of range or malformed', () => {
    expect(parseOverlayOpacities('topo:0.35,other:1')).toEqual(new Map([['topo', 0.35], ['other', 1]]));
    expect(parseOverlayOpacities('topo:2,other:-1,:0.5,bogus,topo:0.4')).toEqual(new Map([['topo', 0.4]]));
    expect(parseOverlayOpacities(undefined)).toEqual(new Map());
    expect(parseOverlayOpacities('')).toEqual(new Map());
  });
});

describe('map config helpers', () => {
  it('prefers the requested basemap, then the default, then the first', () => {
    expect(pickBasemap(config, 'dark')?.id).toBe('dark');
    expect(pickBasemap(config, 'gone')?.id).toBe('terrain');
    expect(pickBasemap({ ...config, basemaps: [{ ...config.basemaps[1] }] }, null)?.id).toBe('dark');
    expect(pickBasemap({ ...config, basemaps: [] })).toBeUndefined();
  });

  it('gives a basemap its own style, or, for one with none, a minimal style built from its raster tiles', () => {
    expect(basemapStyle(config.basemaps[0])).toBe(config.basemaps[0].style);

    const satellite = config.basemaps.find((b) => b.id === 'satellite')!;
    const style = basemapStyle(satellite) as { sources: Record<string, unknown>; layers: { source: string }[] };
    expect(style['sources']['basemap']).toEqual({ type: 'raster', tiles: satellite.tiles, tileSize: satellite.tileSize, attribution: satellite.attribution });
    expect(style['layers']).toEqual([{ id: 'basemap', type: 'raster', source: 'basemap' }]);
  });
});

describe('the pulse of the ring round the open incident', () => {
  const halo = (paint: ReturnType<typeof vi.fn>, property: string) =>
    paint.mock.calls.filter(([layer, p]) => layer === SELECTED_HALO && p === property).map(([, , value]) => value as number);

  it('sends a second ring out from it, fading as it travels, over and over, until stopped', () => {
    vi.useFakeTimers();
    try {
      const setPaintProperty = vi.fn();
      const map = { getLayer: (id: string) => (id === SELECTED_HALO ? {} : undefined), setPaintProperty };
      const stop = pulseSelection(map as never, () => ({ field: null, cap: 0 }));

      vi.advanceTimersByTime(PULSE_MS / 2);
      // Its radius at zoom 14, the last stop of the ring's: it starts at the ring's own and travels out.
      const radii = halo(setPaintProperty, 'circle-radius').map((r) => (r as unknown as number[]).at(-1)!);
      const opacities = halo(setPaintProperty, 'circle-stroke-opacity');
      expect(radii[0]).toBeCloseTo(14, 0);
      expect(radii.at(-1)!).toBeGreaterThan(radii[0] + 10);                      // travelling out
      expect(opacities.at(-1)!).toBeLessThan(opacities[0]);                      // and fading
      vi.advanceTimersByTime(PULSE_MS);
      expect(halo(setPaintProperty, 'circle-radius').length).toBeGreaterThan(radii.length);   // and again

      stop();
      const drawn = setPaintProperty.mock.calls.length;
      expect(halo(setPaintProperty, 'circle-stroke-opacity').at(-1)).toBe(0);   // gone when stopped
      vi.advanceTimersByTime(PULSE_MS);
      expect(setPaintProperty.mock.calls.length).toBe(drawn);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Battlemap', () => {
  it('adds the contact layers and shows the layer panel once the map is ready', async () => {
    const { el, basemaps } = await render({});

    expect([...basemaps.map.layers]).toEqual(expect.arrayContaining([HEAT_LAYER, POINT_LAYER, SELECTED_LAYER]));
    expect(el.querySelector('.bm__count')).toBeNull();
    expect(el.querySelector('app-basemap-picker [role=combobox]')?.textContent).toContain('Terrain');
    expect(el.textContent).toContain('3D terrain');
    expect(el.textContent).toContain('1ATF topo');
  });

  it('lists imagery overlays under Basemap, off by default, and switches one on', async () => {
    const { el, basemaps, fixture } = await render({});

    const basemapFieldset = [...el.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === 'Basemap')!;
    expect(basemapFieldset.querySelector('.panel__subheading')?.textContent).toBe('Imagery');
    const checkbox = [...basemapFieldset.querySelectorAll('label')].find((l) => l.textContent?.includes('1ATF topo'))!.querySelector('input')!;
    expect(checkbox.checked).toBe(false);

    checkbox.click();
    fixture.detectChanges();

    expect(basemaps.setOverlay).toHaveBeenCalledWith('topo', true);
  });

  describe('layer options, hidden behind an arrow until asked for', () => {
    const rowFor = (el: HTMLElement, text: string) => [...el.querySelectorAll('app-layer-row')].find((r) => r.textContent?.includes(text))! as HTMLElement;
    const open = (row: HTMLElement, fixture: { detectChanges(): void }) => {
      row.querySelector<HTMLButtonElement>('.toggle')!.click();
      fixture.detectChanges();
    };

    it('fades the 1ATF topo overlay from its configured default (0.8 in the fixture), without touching it until the arrow is opened', async () => {
      const { el, basemaps, fixture } = await render({});
      const row = rowFor(el, '1ATF topo');
      expect(row.querySelector('.toggle')!.getAttribute('aria-expanded')).toBe('false');

      open(row, fixture);
      const slider = row.querySelector<HTMLInputElement>('input[type=range]')!;
      expect(slider.value).toBe('0.8');

      slider.value = '0';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();

      expect(basemaps.setOverlayOpacity).toHaveBeenCalledWith('topo', 0);
    });

    it('hides the marker size choice behind Incident markers, above Heatmap, until the arrow opens it', async () => {
      const { el, fixture } = await render({});
      const contacts = [...el.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === 'Contacts')!;
      const rows = [...contacts.querySelectorAll('app-layer-row')];
      expect(rows.map((r) => r.querySelector('.row__primary')?.textContent?.trim())).toEqual(['Incident markers', 'Heatmap']);

      const markers = rowFor(el, 'Incident markers');
      expect(markers.querySelector('.options')!.classList.contains('is-open')).toBe(false);
      expect(markers.querySelector('.toggle')!.getAttribute('aria-expanded')).toBe('false');

      open(markers, fixture);

      expect(markers.querySelector('.options')!.classList.contains('is-open')).toBe(true);
      expect(markers.querySelector('select')).not.toBeNull();
    });

    it('hides which field the heatmap shows behind its own arrow', async () => {
      const { el, fixture } = await render({});
      const row = rowFor(el, 'Heatmap');
      expect(row.querySelector('.options')!.classList.contains('is-open')).toBe(false);

      open(row, fixture);

      expect(row.querySelector('.options')!.classList.contains('is-open')).toBe(true);
      expect(row.querySelector('select')!.value).not.toBe('');
    });

    it('offers 3D terrain as a Basemap option, only where terrain is configured', async () => {
      const { el, fixture } = await render({});
      const basemapFieldset = [...el.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === 'Basemap')!;
      const row = basemapFieldset.querySelector<HTMLElement>('app-layer-row')!;
      expect(row.querySelector('.options')!.classList.contains('is-open')).toBe(false);

      open(row, fixture);

      expect(row.querySelector('.options')!.classList.contains('is-open')).toBe(true);
      expect(row.querySelector('input[type=checkbox]')).not.toBeNull();
      expect(row.textContent).toContain('3D terrain');
    });

    it('leaves Basemap with no arrow when the deployment has no terrain configured', async () => {
      const { el } = await render({ config: { ...config, terrain: null } });
      const basemapFieldset = [...el.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === 'Basemap')!;
      const pickerRow = [...basemapFieldset.querySelectorAll('app-layer-row')].find((r) => r.querySelector('app-basemap-picker'))!;

      expect(pickerRow.querySelector('.toggle')).toBeNull();
    });
  });

  it('starts from the view in the URL', async () => {
    const { basemaps } = await render({
      inputs: { at: '10.6,107.2,11', basemap: 'dark', terrain: '1', overlays: 'topo', opacity: 'topo:0.35' },
    });

    expect(basemaps.startedWith).toEqual({
      basemapId: 'dark',
      camera: { lat: 10.6, lon: 107.2, zoom: 10 },
      terrain: true,
      overlays: ['topo'],
      overlayOpacities: new Map([['topo', 0.35]]),
    });
  });

  it('passes the chosen basemap through to the map', async () => {
    const { el, basemaps, fixture } = await render({});

    el.querySelector<HTMLButtonElement>('app-basemap-picker [role=combobox]')!.click();
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLElement>('app-basemap-picker [role=option]')].find((o) => o.textContent?.includes('Dark'))!.click();
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

  it('scales the markers by the field chosen in the layers panel, and puts the choice in the link', async () => {
    const { el, basemaps, fixture } = await render({});
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    basemaps.map.setPaintProperty.mockClear();

    const label = [...el.querySelectorAll('label.panel__select')].find((l) => l.textContent?.includes('Marker size'))!;
    const select = label.querySelector('select')!;
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
      'The same for every incident',
      'Size of friendly force',
      'Friendly force killed',
      'Friendly force wounded',
      'Size of enemy force',
      'Enemy force killed',
      'Enemy force wounded',
    ]);
    select.value = 'enKia';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    await wait(450);

    // Enemy killed is 0, 5 and 3 in the fixtures, so the cap is 5.
    expect(basemaps.map.setPaintProperty).toHaveBeenCalledWith(POINT_LAYER, 'circle-radius', pointRadius({ field: 'enKia', cap: 5 }));
    expect(basemaps.map.setPaintProperty).toHaveBeenCalledWith(SELECTED_LAYER, 'circle-radius', selectedRadius({ field: 'enKia', cap: 5 }));
    expect(navigate.mock.calls.at(-1)![1]!.queryParams!['size']).toBe('enKia');

    select.value = 'none';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    await wait(450);
    expect(basemaps.map.setPaintProperty).toHaveBeenLastCalledWith(SELECTED_LAYER, 'circle-radius', selectedRadius({ field: null, cap: 0 }));
    expect(navigate.mock.calls.at(-1)![1]!.queryParams!['size']).toBeNull();
  });

  const checkboxFor = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll('label')].find((l) => l.textContent?.includes(text))!.querySelector<HTMLInputElement>('input[type=checkbox]')!;

  it('puts a layer switched away from its default in the link (the heatmap starts off), but leaves it out while every layer is at its default', async () => {
    const { el, fixture } = await render({});
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    checkboxFor(el, 'Bases and landing zones').click();
    checkboxFor(el, 'Incident markers').click();
    checkboxFor(el, 'Heatmap').click();
    await settle(fixture);
    await wait(450);

    const params = navigate.mock.calls.at(-1)![1]!.queryParams!;
    expect(params['bases']).toBe('0');
    expect(params['markers']).toBe('0');
    expect(params['heatmap']).toBe('1');
    expect(params['photos']).toBeNull();

    checkboxFor(el, 'Bases and landing zones').click();
    checkboxFor(el, 'Incident markers').click();
    checkboxFor(el, 'Heatmap').click();
    await settle(fixture);
    await wait(450);

    const restored = navigate.mock.calls.at(-1)![1]!.queryParams!;
    expect(restored['bases']).toBeNull();
    expect(restored['markers']).toBeNull();
    expect(restored['heatmap']).toBeNull();
  });

  it('puts community photos switched off in the link too', async () => {
    const pic = { id: 5, mediaId: 1, contactId: null, url: '/media/a.jpg', thumbUrl: '/media/a-480.jpg', width: 800, height: 600, caption: null, credit: null, dateTaken: '1966-08-18', lat: 10.56, lon: 107.17, status: 'Approved' as const, likes: 0, likedByMe: false, byteSize: 1, contentType: 'image/jpeg', addedUtc: '2018-09-02T04:15:00Z', addedBy: 'Alex Member', mine: false, canRemove: false };
    const { el, fixture } = await render({ community: { mediaOnMap: vi.fn(() => Promise.resolve([pic])) } });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    checkboxFor(el, 'Community photos').click();
    await settle(fixture);
    await wait(450);

    expect(navigate.mock.calls.at(-1)![1]!.queryParams!['photos']).toBe('0');
  });

  it('restores which layers are switched on from the link', async () => {
    const { el } = await render({ inputs: { bases: '0', photos: '0', markers: '0', heatmap: '1' } });

    expect(checkboxFor(el, 'Bases and landing zones').checked).toBe(false);
    expect(checkboxFor(el, 'Incident markers').checked).toBe(false);
    expect(checkboxFor(el, 'Heatmap').checked).toBe(true);
  });

  it('starts with the heatmap off', async () => {
    expect(checkboxFor((await render({})).el, 'Heatmap').checked).toBe(false);
  });

  it('keeps the heatmap off for an older link that switched it off', async () => {
    expect(checkboxFor((await render({ inputs: { heatmap: '0' } })).el, 'Heatmap').checked).toBe(false);
  });

  it('keeps a changed overlay opacity in the link, but not one left at its configured default', async () => {
    const { el, fixture, basemaps } = await render({});
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const row = [...el.querySelectorAll('app-layer-row')].find((r) => r.textContent?.includes('1ATF topo'))! as HTMLElement;
    row.querySelector<HTMLButtonElement>('.toggle')!.click();
    fixture.detectChanges();
    const slider = row.querySelector<HTMLInputElement>('input[type=range]')!;

    slider.value = '0.3';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(fixture);
    await wait(450);

    expect(basemaps.setOverlayOpacity).toHaveBeenCalledWith('topo', 0.3);
    expect(navigate.mock.calls.at(-1)![1]!.queryParams!['opacity']).toBe('topo:0.3');

    // Back to the fixture's own configured default (0.8): the link should stop mentioning it.
    slider.value = '0.8';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(fixture);
    await wait(450);

    expect(navigate.mock.calls.at(-1)![1]!.queryParams!['opacity']).toBeNull();
  });

  it('restores an overlay opacity from the link', async () => {
    const { el, fixture } = await render({ inputs: { opacity: 'topo:0.35' } });
    const row = [...el.querySelectorAll('app-layer-row')].find((r) => r.textContent?.includes('1ATF topo'))! as HTMLElement;
    row.querySelector<HTMLButtonElement>('.toggle')!.click();
    fixture.detectChanges();

    expect(row.querySelector<HTMLInputElement>('input[type=range]')!.value).toBe('0.35');
  });

  const pointPaint = (r: Awaited<ReturnType<typeof render>>) =>
    r.basemaps.map.addLayer.mock.calls.map((c) => c[0] as { id: string; paint: Record<string, unknown> }).find((l) => l.id === POINT_LAYER)!.paint;

  it('opens with the marker size from the link', async () => {
    const r = await render({ inputs: { size: 'frWia' } });
    expect(pointPaint(r)['circle-radius']).toEqual(pointRadius({ field: 'frWia', cap: 1 }));
  });

  it('ignores a marker size in the link that it does not know', async () => {
    const r = await render({ inputs: { size: 'bogus' } });
    expect(pointPaint(r)['circle-radius']).toEqual(pointRadius({ field: null, cap: 0 }));
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

  it('opens straight onto an incident from the link: everything first, then in close (zoom 15) on it, when the link has no view', async () => {
    const { el, basemaps } = await render({ inputs: { incident: '9' } });

    expect(el.querySelector('app-incident-panel')).not.toBeNull();
    expect(basemaps.fitTo).toHaveBeenCalledTimes(1);
    expect(basemaps.flyTo).not.toHaveBeenCalled();                                     // not until the whole view has settled

    arrive(basemaps.map);
    expect(basemaps.flyTo).toHaveBeenCalledWith(10.61, 107.2, 15, expect.objectContaining({ right: expect.any(Number) }));   // centred beside the panels
  });

  it('points out an incident opened from the link once the map has come to it, with a reticule that closes in and goes', async () => {
    const { basemaps } = await render({ inputs: { incident: '9' } });
    const map = basemaps.map;
    arrive(map);                                                                       // the whole view has settled
    expect(map.container.querySelector('.home-in')).toBeNull();                        // not until the map has come to the incident

    arrive(map);
    const reticule = map.container.querySelector<HTMLElement>('.home-in')!;
    expect(reticule.getAttribute('aria-hidden')).toBe('true');
    expect(reticule.style.transform).toBe('translate(107200px, -10610px)');           // on the incident, as the fake map projects it

    reticule.dispatchEvent(new Event('animationend'));
    expect(map.container.querySelector('.home-in')).toBeNull();
  });

  it('draws the ring round the open incident, and its ripple, over every other layer, photos included', async () => {
    const { basemaps } = await render({ inputs: { incident: '9' } });
    const moved = basemaps.map.moveLayer.mock.calls.map(([id, before]) => [id, before]);

    expect(moved.slice(-2)).toEqual([[SELECTED_HALO, undefined], [SELECTED_LAYER, undefined]]);   // to the top: the ring over its ripple
    const lastAdded = Math.max(...basemaps.map.addLayer.mock.invocationCallOrder);
    expect(basemaps.map.moveLayer.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(lastAdded);  // after every layer is added
  });

  it('points out nothing when the link opens no incident', async () => {
    const { basemaps } = await render();
    expect(basemaps.map.once).not.toHaveBeenCalled();
    expect(basemaps.map.container.querySelector('.home-in')).toBeNull();
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
