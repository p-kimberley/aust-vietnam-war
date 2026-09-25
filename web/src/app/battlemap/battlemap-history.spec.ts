import { describe, expect, it, vi } from 'vitest';
import { render, settle } from './battlemap-testing';
import { MapViewStateService } from './map-view-state.service';
import { Battlemap } from './battlemap';

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

/** Renders the map and hands back a way to go Back or Forward to an entry with these query parameters. */
async function withHistory(opts: Parameters<typeof render>[0] = {}) {
  const r = await render(opts);
  const map = r.basemaps.map as unknown as { easeTo: ReturnType<typeof vi.fn> };
  map.easeTo = vi.fn();
  const history = r.fixture.debugElement.injector.get(MapViewStateService);
  const goTo = async (params: Record<string, string>) => {
    history.onRestore!(params);
    await settle(r.fixture);
  };
  return { ...r, easeTo: map.easeTo, goTo };
}

describe('Back and Forward on the Battle Map', () => {
  it('is listened for once the map has started', async () => {
    const r = await render();
    expect(r.fixture.debugElement.injector.get(MapViewStateService).onRestore).toBeTypeOf('function');
    expect(r.fixture.componentInstance).toBeInstanceOf(Battlemap);
  });

  it('opens what the entry had open, and moves the camera to where it was, without flying to it', async () => {
    const r = await withHistory();

    await r.goTo({ incident: '9', at: '10.6,107.2,12' });

    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
    expect(r.easeTo).toHaveBeenCalledWith({ center: [107.2, 10.6], zoom: 11, duration: 600 });
    expect(r.basemaps.flyTo).not.toHaveBeenCalled();
  });

  it('closes what the entry did not have open', async () => {
    const r = await withHistory({ inputs: { incident: '2' } });
    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();

    await r.goTo({ at: '10.6,107.2,12' });

    expect(r.el.querySelector('app-incident-panel')).toBeNull();
  });

  it('opens a base, a person, the picture viewer and the tool at the left as the entry had them', async () => {
    const r = await withHistory();

    await r.goTo({ poi: '1', picture: '5', roll: '1' });
    expect(r.el.querySelector('app-poi-panel')).not.toBeNull();
    expect(r.el.querySelector('app-picture-viewer')).not.toBeNull();
    expect(r.el.querySelector('#left-flyout app-nominal-roll')).not.toBeNull();

    await r.goTo({ person: '5715978' });
    expect(r.el.querySelector('app-honour-panel')).not.toBeNull();
    expect(r.el.querySelector('app-picture-viewer')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 350));                    // the fly-out slides away
    await settle(r.fixture);
    expect(r.el.querySelector('#left-flyout app-nominal-roll')).toBeNull();
  });

  it('puts back the basemap, terrain and layers', async () => {
    const r = await withHistory();

    await r.goTo({ basemap: 'dark', terrain: '1', markers: '0', photos: '0' });

    expect(r.basemaps.setBasemap).toHaveBeenLastCalledWith('dark');
    expect(r.basemaps.setTerrain).toHaveBeenCalledWith(true);
    expect(r.basemaps.map.setLayoutProperty).toHaveBeenCalledWith('avw-contacts-points', 'visibility', 'none');
    const markers = [...r.el.querySelectorAll<HTMLInputElement>('#tabpanel input[type=checkbox]')].find((i) => i.parentElement?.textContent?.includes('Incident markers'))!;
    expect(markers.checked).toBe(false);
  });

  it('puts back the filters, redrawing the contacts without zooming to them', async () => {
    const r = await withHistory();
    r.basemaps.map.setData.mockClear();
    const fits = r.basemaps.fitTo.mock.calls.length;

    await r.goTo({ from: '1966-03-04' });

    const drawn = r.basemaps.map.setData.mock.calls.at(-1)![0] as { features: { properties: { id: number } }[] };
    expect(drawn.features.map((f) => f.properties.id)).toEqual([9, 11]);
    expect(r.basemaps.fitTo.mock.calls.length).toBe(fits);                     // the entry's own camera, not a fit
    expect(text(r.el.querySelector('#right-tab-filters .tab__badge'))).toBe('1');
  });
});
