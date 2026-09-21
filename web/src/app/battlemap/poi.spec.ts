import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { POIS, poiDetail, render, settle } from './battlemap-testing';
import { Poi, PoiService, poiLabel, typeName } from './poi';
import { POI_ICON_IDS } from './poi-icons';
import { POI_LABELS, POI_POINTS, POI_SELECTED, POI_SOURCE, addPoiLayers, setPoiVisibility, setSelectedPoi, toPoiGeoJson } from './poi-layers';
import { PoiPanel } from './poi-panel';

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

describe('poi helpers', () => {
  it('names the type codes and falls back to the code', () => {
    expect(typeName('FSB')).toBe('Fire Support Base');
    expect(typeName('FSPB')).toBe('Fire Support Patrol Base');
    expect(typeName('LZ')).toBe('Landing Zone');
    expect(typeName('Weird')).toBe('Weird');
  });

  it('labels a point with its type and name', () => {
    expect(poiLabel({ type: 'FSB', name: 'Le Loi' })).toBe('FSB Le Loi');
    expect(poiLabel({ type: '', name: 'Nui Dat' })).toBe('Nui Dat');
  });

  it('converts points to GeoJSON with [lon, lat] coordinates', () => {
    const fc = toPoiGeoJson(POIS);
    expect(fc.features[0].geometry.coordinates).toEqual([107.24, 10.63]);
    expect(fc.features[0].properties).toEqual({ id: 1, type: 'FSB', label: 'FSB Le Loi' });
    expect(fc.features[1].id).toBe(2);
  });
});

describe('PoiService', () => {
  function setup() {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    return { ctl: TestBed.inject(HttpTestingController), service: TestBed.inject(PoiService) };
  }

  it('loads the list once and shares it', async () => {
    const { ctl, service } = setup();
    const a = service.list();
    const b = service.list();
    ctl.expectOne('/api/pois').flush(POIS);
    expect(await a).toEqual(POIS);
    expect(await b).toEqual(POIS);
    ctl.verify();
  });

  it('does not remember a failed list load', async () => {
    const { ctl, service } = setup();
    const failed = service.list();
    ctl.expectOne('/api/pois').flush('x', { status: 500, statusText: 'Server Error' });
    await expect(failed).rejects.toBeInstanceOf(HttpErrorResponse);

    const retry = service.list();
    ctl.expectOne('/api/pois').flush(POIS);
    expect(await retry).toEqual(POIS);
  });

  it('remembers a detail, and that a point does not exist, but retries failures', async () => {
    const { ctl, service } = setup();

    const first = service.detail(1);
    ctl.expectOne('/api/pois/1').flush(poiDetail);
    expect(await first).toEqual(poiDetail);
    expect(await service.detail(1)).toEqual(poiDetail);

    const missing = service.detail(9);
    ctl.expectOne('/api/pois/9').flush(null, { status: 404, statusText: 'Not Found' });
    expect(await missing).toBeNull();

    const broken = service.detail(5);
    ctl.expectOne('/api/pois/5').flush('x', { status: 500, statusText: 'Server Error' });
    await expect(broken).rejects.toBeInstanceOf(HttpErrorResponse);
    const retry = service.detail(5);
    ctl.expectOne('/api/pois/5').flush({ ...poiDetail, id: 5 });
    expect((await retry)!.id).toBe(5);
  });
});

describe('POI layers', () => {
  function fake() {
    const sources = new Set<string>();
    const layers = new Map<string, Record<string, unknown>>();
    const images = new Set<string>();
    return {
      sources,
      layers,
      images,
      hasImage: (id: string) => images.has(id),
      addImage: vi.fn((id: string, _image?: unknown, _options?: unknown) => void images.add(id)),
      getSource: (id: string) => (sources.has(id) ? {} : undefined),
      getLayer: (id: string) => layers.get(id),
      addSource: vi.fn((id: string) => void sources.add(id)),
      addLayer: vi.fn((l: { id: string }) => void layers.set(l.id, l)),
      setLayoutProperty: vi.fn(),
      setFilter: vi.fn(),
    };
  }

  it('adds a source, markers, labels and a selection ring, once', () => {
    const map = fake();

    addPoiLayers(map as never, POIS, { visible: true, selectedId: null });
    addPoiLayers(map as never, POIS, { visible: true, selectedId: null });

    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addSource.mock.calls[0][0]).toBe(POI_SOURCE);
    expect([...map.layers.keys()]).toEqual([POI_POINTS, POI_LABELS, POI_SELECTED]);
  });

  it('draws each type of point with its own icon, and anything else as a flag', () => {
    const map = fake();
    addPoiLayers(map as never, POIS, { visible: true, selectedId: null });

    const layer = map.layers.get(POI_POINTS)!;
    expect(layer['type']).toBe('symbol');
    const icon = (layer['layout'] as Record<string, unknown[]>)['icon-image'];
    expect(icon).toEqual([
      'match',
      ['get', 'type'],
      'FSB',
      'avw-poi-fsb',
      'FSPB',
      'avw-poi-fspb',
      'LZ',
      'avw-poi-lz',
      'Base',
      'avw-poi-base',
      'avw-poi-other',
    ]);
    // Every icon the layer can ask for is one that gets registered.
    expect(icon.filter((v) => typeof v === 'string' && v.startsWith('avw-poi-'))).toEqual(expect.arrayContaining([...POI_ICON_IDS]));
  });

  describe('icons', () => {
    // jsdom has no canvas, so a stand-in that accepts every drawing call and hands back a blank image.
    const canvasContext = new Proxy({}, { get: (_t, name) => (name === 'getImageData' ? () => ({ width: 48, height: 48, data: new Uint8ClampedArray(48 * 48 * 4) }) : vi.fn()), set: () => true });

    function withCanvas(run: () => void): void {
      vi.stubGlobal('Path2D', class { constructor(_path?: string) {} rect() {} arc() {} });
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext as never);
      try {
        run();
      } finally {
        getContext.mockRestore();
        vi.unstubAllGlobals();
      }
    }

    it('registers one image for each icon before the layer that uses them, at twice the density', () => {
      withCanvas(() => {
        const map = fake();
        addPoiLayers(map as never, POIS, { visible: true, selectedId: null });

        expect(map.addImage.mock.calls.map((c) => c[0])).toEqual(POI_ICON_IDS);
        expect(map.addImage.mock.calls.every((c) => (c[2] as { pixelRatio: number }).pixelRatio === 2)).toBe(true);
        expect(map.addImage.mock.invocationCallOrder[0]).toBeLessThan(map.addLayer.mock.invocationCallOrder[0]);
      });
    });

    it('leaves images that are already there, and adds them again to a new style', () => {
      withCanvas(() => {
        const map = fake();
        addPoiLayers(map as never, POIS, { visible: true, selectedId: null });
        map.layers.clear();
        addPoiLayers(map as never, POIS, { visible: true, selectedId: null });
        expect(map.addImage).toHaveBeenCalledTimes(POI_ICON_IDS.length);

        // Switching basemap discards the images along with the style.
        map.images.clear();
        map.layers.clear();
        addPoiLayers(map as never, POIS, { visible: true, selectedId: null });
        expect(map.addImage).toHaveBeenCalledTimes(POI_ICON_IDS.length * 2);
      });
    });

    it('carries on without icons where there is no canvas', () => {
      vi.stubGlobal('Path2D', undefined);
      try {
        const map = fake();
        expect(() => addPoiLayers(map as never, POIS, { visible: true, selectedId: null })).not.toThrow();
        expect(map.addImage).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it('starts hidden when the layer is off, and rings the selected point only while shown', () => {
    const off = fake();
    addPoiLayers(off as never, POIS, { visible: false, selectedId: 1 });
    expect((off.layers.get(POI_POINTS)!['layout'] as { visibility: string }).visibility).toBe('none');
    expect(off.layers.get(POI_SELECTED)!['filter']).toEqual(['==', ['get', 'id'], -1]);

    const on = fake();
    addPoiLayers(on as never, POIS, { visible: true, selectedId: 1 });
    expect(on.layers.get(POI_SELECTED)!['filter']).toEqual(['==', ['get', 'id'], 1]);
  });

  it('shows and hides markers and labels together, dropping the ring when hidden', () => {
    const map = fake();
    addPoiLayers(map as never, POIS, { visible: true, selectedId: 1 });

    setPoiVisibility(map as never, false);

    expect(map.setLayoutProperty).toHaveBeenCalledWith(POI_POINTS, 'visibility', 'none');
    expect(map.setLayoutProperty).toHaveBeenCalledWith(POI_LABELS, 'visibility', 'none');
    expect(map.setFilter).toHaveBeenCalledWith(POI_SELECTED, ['==', ['get', 'id'], -1]);
  });

  it('rings a point, or clears the ring', () => {
    const map = fake();
    addPoiLayers(map as never, POIS, { visible: true, selectedId: null });

    setSelectedPoi(map as never, 2);
    setSelectedPoi(map as never, null);

    expect(map.setFilter.mock.calls).toEqual([
      [POI_SELECTED, ['==', ['get', 'id'], 2]],
      [POI_SELECTED, ['==', ['get', 'id'], -1]],
    ]);
  });
});

describe('PoiPanel', () => {
  function panel(id = 1) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    const ctl = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(PoiPanel);
    fixture.componentRef.setInput('poiId', id);
    fixture.detectChanges();
    return { fixture, ctl, el: fixture.nativeElement as HTMLElement };
  }

  const tick = async (f: { detectChanges(): void }) => {
    f.detectChanges();
    await new Promise((r) => setTimeout(r));
    f.detectChanges();
  };

  it('shows the name, type, year and history', async () => {
    const { fixture, ctl, el } = panel();
    await tick(fixture);
    expect(text(el)).toContain('Loading');

    ctl.expectOne('/api/pois/1').flush(poiDetail);
    await tick(fixture);

    expect(text(el.querySelector('.poi__name'))).toBe('Le Loi');
    expect(text(el)).toContain('Fire Support Base');
    expect(text(el)).toContain('1970');
    expect(text(el.querySelector('.poi__history'))).toBe('On Route 2, north of Nui Dat.');
  });

  it('omits the year when unknown and says when there is no history', async () => {
    const { fixture, ctl, el } = panel(2);
    await tick(fixture);
    ctl.expectOne('/api/pois/2').flush({ ...POIS[1], details: null });
    await tick(fixture);

    expect(text(el)).not.toContain('Established');
    expect(text(el.querySelector('.poi__history'))).toBe('No history is recorded.');
  });

  it('says so when the point does not exist, and offers a retry when loading fails', async () => {
    const missing = panel(9);
    await tick(missing.fixture);
    missing.ctl.expectOne('/api/pois/9').flush(null, { status: 404, statusText: 'Not Found' });
    await tick(missing.fixture);
    expect(text(missing.el)).toContain('not found');

    const broken = panel(1);
    await tick(broken.fixture);
    broken.ctl.expectOne('/api/pois/1').flush('x', { status: 500, statusText: 'Server Error' });
    await tick(broken.fixture);
    expect(text(broken.el.querySelector('[role=alert]'))).toContain('could not be loaded');
  });

  it('tells the parent when it is closed', async () => {
    const { fixture, ctl, el } = panel();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    await tick(fixture);
    ctl.expectOne('/api/pois/1').flush(poiDetail);
    await tick(fixture);

    el.querySelector<HTMLButtonElement>('.poi__close')!.click();

    expect(closed).toBe(1);
  });
});

describe('Battle Map points of interest', () => {
  it('draws the points and offers a switch for them', async () => {
    const r = await render({});

    expect(r.basemaps.map.sources.has(POI_SOURCE)).toBe(true);
    expect(text(r.el.querySelector('#tabpanel'))).toContain('Bases and landing zones');
  });

  it('draws them before the contacts, so contacts sit on top', async () => {
    const r = await render({});
    const order = r.basemaps.map.addLayer.mock.calls.map((c) => (c[0] as { id: string }).id);

    expect(order.indexOf(POI_POINTS)).toBeLessThan(order.indexOf('avw-contacts-points'));
  });

  it('hides them with the switch', async () => {
    const r = await render({});

    const box = [...r.el.querySelectorAll<HTMLInputElement>('#tabpanel input[type=checkbox]')]
      .find((i) => i.parentElement?.textContent?.includes('Bases and landing zones'))!;
    box.click();
    await settle(r.fixture);

    expect(r.basemaps.map.setLayoutProperty).toHaveBeenCalledWith(POI_POINTS, 'visibility', 'none');
  });

  it('opens the point panel when a point is clicked, and closes the incident panel', async () => {
    const r = await render({ inputs: { incident: '2' } });
    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();

    // The page registers the point handler first, then the contact handler.
    r.basemaps.bindClick.mock.calls.find((c) => c[0] === POI_POINTS)![1]({ id: 1 });
    await settle(r.fixture);

    expect(r.el.querySelector('app-poi-panel')).not.toBeNull();
    expect(r.el.querySelector('app-incident-panel')).toBeNull();
  });

  it('closes the point panel when a contact is clicked', async () => {
    const r = await render({ inputs: { poi: '1' } });
    expect(r.el.querySelector('app-poi-panel')).not.toBeNull();

    r.basemaps.clickHandler!({ id: 9 });
    await settle(r.fixture);

    expect(r.el.querySelector('app-poi-panel')).toBeNull();
    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
  });

  it('opens straight onto a point from a link and frames it', async () => {
    const r = await render({ inputs: { poi: '2' } });

    expect(r.el.querySelector('app-poi-panel')).not.toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(10.5, 107.1, 11);
  });

  it.each(['abc', '99999', '-1'])('ignores a poi link that is not a real point (%s)', async (bad) => {
    const r = await render({ inputs: { poi: bad } });
    expect(r.el.querySelector('app-poi-panel')).toBeNull();
    expect(r.basemaps.flyTo).not.toHaveBeenCalled();
  });

  it('still opens without them when they cannot be loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await render({ pois: new Error('down') });

    expect(r.el.querySelector('app-timeline')).not.toBeNull();
    expect(text(r.el.querySelector('#tabpanel'))).not.toContain('Bases and landing zones');
    warn.mockRestore();
  });
});
