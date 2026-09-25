import type { FeatureCollection } from 'geojson';
import { describe, expect, it, vi } from 'vitest';
import { fakeMap, render, settle } from './battlemap-testing';
import { IncidentMediaView } from './community/community';
import { PHOTO_IMAGES } from './photo-layers';
import { PhotoSpider, SPIDER_SOURCE } from './photo-spider';
import {
  STACK_BADGES,
  STACK_COUNTS,
  STACK_SOURCE,
  addStackLayers,
  findStacks,
  setStackVisibility,
  setStacks,
  stackFilter,
  stackIds,
  toStackGeoJson,
  worldPixels,
} from './photo-stacks';

/** A picture this many pixels east of 107.17 E, 10.56 N at zoom 15. */
function at(id: number, pxEast: number) {
  const [x0] = worldPixels({ lon: 107.17, lat: 10.56 }, 15);
  const lon = ((x0 + pxEast) / ((512 * 2 ** 15) / (2 * Math.PI)) - Math.PI) * (180 / Math.PI);
  return { id, lon, lat: 10.56 };
}

describe('findStacks', () => {
  it('finds pictures in one spot, and those close enough to hide each other', () => {
    const stacks = findStacks([at(1, 0), at(2, 0), at(3, 10), at(4, 200)], 15);

    expect(stacks.map((s) => s.map((p) => p.id))).toEqual([[1, 2, 3]]);
  });

  it('chains pictures a little apart into one stack', () => {
    expect(findStacks([at(1, 0), at(2, 20), at(3, 40)], 15).map((s) => s.length)).toEqual([3]);
  });

  it('depends on the zoom: pictures apart close in, stacked further out', () => {
    const pictures = [at(1, 0), at(2, 40)];

    expect(findStacks(pictures, 15)).toEqual([]);
    expect(findStacks(pictures, 14)).toHaveLength(1);                     // 20 pixels apart there
  });

  it('finds nothing among pictures on their own', () => {
    expect(findStacks([at(1, 0)], 15)).toEqual([]);
    expect(findStacks([], 15)).toEqual([]);
  });
});

describe('stack badges', () => {
  it('puts one badge in the middle of each stack, with how many and which', () => {
    const geo = toStackGeoJson([[at(5, 0), at(6, 0)]]);

    expect(geo.features).toHaveLength(1);
    expect(geo.features[0].properties).toEqual({ count: 2, ids: ',5,6,' });
    expect(stackIds(geo.features[0].properties.ids)).toEqual([5, 6]);
  });

  it('adds a disc and a count once, empty, from zoom 14, and shows and hides them with the photos', () => {
    const map = { ...fakeMap(), getZoom: () => 15 };
    addStackLayers(map as never, false);
    addStackLayers(map as never, true);

    const layers = map.addLayer.mock.calls.map((c) => c[0] as { id: string; minzoom: number; layout: { visibility: string } });
    expect(layers.map((l) => l.id)).toEqual([STACK_BADGES, STACK_COUNTS]);
    expect(layers.every((l) => l.minzoom === 14 && l.layout.visibility === 'none')).toBe(true);
    const data = map.addSource.mock.calls.find((c) => c[0] === STACK_SOURCE)![1] as { data: FeatureCollection };
    expect(data.data.features).toEqual([]);                                  // filled in once the zoom is known

    setStackVisibility(map as never, true);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(STACK_COUNTS, 'visibility', 'visible');
  });

  it('works the stacks out again for the zoom the map is at', () => {
    let zoom = 15;
    const map = { ...fakeMap(), getZoom: () => zoom };
    addStackLayers(map as never, true);
    const pictures = [at(1, 0), at(2, 40)];

    setStacks(map as never, pictures);
    zoom = 14;
    setStacks(map as never, pictures);

    expect(map.dataFor(STACK_SOURCE).mock.calls.map((c) => (c[0] as FeatureCollection).features.length)).toEqual([0, 1]);
  });

  it('hides the badge of a stack while it is spread out', () => {
    const map = fakeMap();
    for (const id of [STACK_BADGES, STACK_COUNTS, PHOTO_IMAGES]) map.layers.add(id);
    const spider = new PhotoSpider(map as never);
    spider.addLayers();

    spider.spread({ lon: 107.17, lat: 10.56 }, [at(5, 0), at(6, 0)]);
    expect(map.setFilter).toHaveBeenCalledWith(STACK_BADGES, stackFilter([5, 6]));

    spider.close();
    expect(map.setFilter).toHaveBeenLastCalledWith(STACK_COUNTS, ['has', 'count']);
  });
});

describe('stack badges on the Battle Map', () => {
  const pic = (id: number, lat: number, lon: number) =>
    ({ id, mediaId: id, contactId: null, url: '/m.jpg', thumbUrl: '/t.jpg', width: 1, height: 1, caption: null, credit: null, dateTaken: null, lat, lon, status: 'Approved', likes: 0, likedByMe: false, mine: false, canRemove: false, byteSize: 1, contentType: 'image/jpeg', addedUtc: '2020-01-01T00:00:00Z', addedBy: null }) as IncidentMediaView;
  const PICS = [pic(5, 10.56, 107.17), pic(6, 10.56, 107.17), pic(7, 10.7, 107.3)];

  it('springs a stack apart when its badge is clicked, and the thumbnail under the badge does not open', async () => {
    const r = await render({ community: { mediaOnMap: vi.fn(() => Promise.resolve(PICS)) } });
    r.basemaps.map.queryRenderedFeatures.mockImplementation((_p?: unknown, o?: unknown) =>
      (o as { layers: string[] }).layers.includes(STACK_BADGES) ? [{ properties: { ids: ',5,6,' } }] : [],
    );

    r.basemaps.handlers.get(PHOTO_IMAGES)!({ id: 5 }, { lon: 107.17, lat: 10.56 });
    r.basemaps.handlers.get(STACK_BADGES)!({ ids: ',5,6,' });
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-viewer')).toBeNull();
    const spread = r.basemaps.map.dataFor(SPIDER_SOURCE).mock.calls.at(-1)![0] as FeatureCollection;
    expect(spread.features.map((f) => f.properties!['id'])).toEqual([5, 6]);
  });

  it('works the stacks out again when a zoom ends', async () => {
    const r = await render({ community: { mediaOnMap: vi.fn(() => Promise.resolve(PICS)) } });
    const zoomend = r.basemaps.map.on.mock.calls.find((c) => c[0] === 'zoomend')![1] as () => void;
    const before = r.basemaps.map.dataFor(STACK_SOURCE).mock.calls.length;

    zoomend();

    expect(r.basemaps.map.dataFor(STACK_SOURCE).mock.calls.length).toBe(before + 1);
  });
});
