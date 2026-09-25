import type { FeatureCollection } from 'geojson';
import { describe, expect, it, vi } from 'vitest';
import { fakeMap } from './battlemap-testing';
import { PHOTO_CLUSTERS, PHOTO_COUNTS, PHOTO_IMAGES, PHOTO_IMAGE_SIZE, PHOTO_POINTS, PHOTO_THUMBNAIL_RING } from './photo-layers';
import {
  PhotoSpider,
  SPIDER_CIRCLE_MAX,
  SPIDER_IMAGES,
  SPIDER_LEGS_SOURCE,
  SPIDER_RING,
  SPIDER_SOURCE,
  SPIDER_SPACING_PX,
  isStack,
  spiderOffsets,
  springOut,
} from './photo-spider';

const distance = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('spiderOffsets', () => {
  it('puts a few pictures evenly round a circle, the first at the top', () => {
    const spots = spiderOffsets(4);

    expect(spots).toHaveLength(4);
    expect(spots[0][0]).toBeCloseTo(0);
    expect(spots[0][1]).toBeLessThan(0);                                          // up, on the screen
    const radii = spots.map((s) => Math.hypot(...s));
    for (const r of radii) expect(r).toBeCloseTo(radii[0]);
  });

  it.each([2, 5, SPIDER_CIRCLE_MAX, SPIDER_CIRCLE_MAX + 1, 30])('keeps %i pictures at least a thumbnail apart', (count) => {
    const spots = spiderOffsets(count);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(distance(spots[i], spots[j])).toBeGreaterThanOrEqual(SPIDER_SPACING_PX * 0.85);
      }
    }
    // And clear of the stack itself, where the legs meet.
    for (const s of spots) expect(Math.hypot(...s)).toBeGreaterThan(SPIDER_SPACING_PX * 0.8);
  });

  it('winds many out in a spiral, each further out than the one before', () => {
    const radii = spiderOffsets(20).map((s) => Math.hypot(...s));
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
  });

  it('has nowhere to put nothing', () => {
    expect(spiderOffsets(0)).toEqual([]);
  });
});

describe('springOut', () => {
  it('starts at the stack, overshoots a little, and settles where it is going', () => {
    expect(springOut(0)).toBeCloseTo(0);
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(springOut))).toBeGreaterThan(1);
    expect(springOut(1)).toBeCloseTo(1);
    expect(springOut(2)).toBeCloseTo(1);
  });
});

describe('isStack', () => {
  it('is pictures so close that their thumbnails would lie on each other', () => {
    expect(isStack([{ lon: 107.17, lat: 10.56 }, { lon: 107.17, lat: 10.56 }])).toBe(true);
    expect(isStack([{ lon: 107.17, lat: 10.56 }, { lon: 107.1701, lat: 10.5601 }])).toBe(true);    // about 15 m apart
  });

  it('is not pictures far enough apart to see each on its own, nor one picture alone', () => {
    expect(isStack([{ lon: 107.17, lat: 10.56 }, { lon: 107.18, lat: 10.56 }])).toBe(false);       // about 1 km
    expect(isStack([{ lon: 107.17, lat: 10.56 }])).toBe(false);
  });
});

describe('PhotoSpider', () => {
  function spider() {
    const map = fakeMap();
    for (const id of [PHOTO_CLUSTERS, PHOTO_COUNTS, PHOTO_POINTS, PHOTO_IMAGES]) map.layers.add(id);
    const s = new PhotoSpider(map as never);
    s.addLayers();
    return { map, s };
  }
  const last = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.at(-1)![0] as FeatureCollection;
  const pictures = [
    { id: 5, lon: 107.17, lat: 10.56 },
    { id: 6, lon: 107.17, lat: 10.56 },
    { id: 7, lon: 107.17, lat: 10.56 },
  ];

  it('adds its layers once, empty, on top', () => {
    const { map, s } = spider();
    s.addLayers();

    expect(map.addLayer.mock.calls.map((c) => c[0].id)).toEqual(expect.arrayContaining([SPIDER_IMAGES, SPIDER_RING]));
    expect(map.addLayer.mock.calls.filter((c) => c[0].id === SPIDER_IMAGES)).toHaveLength(1);
    expect(s.open).toEqual([]);
  });

  it('springs the pictures out round the stack on legs, and hides them where they were', () => {
    const { map, s } = spider();

    s.spread({ lon: 107.17, lat: 10.56 }, pictures);

    expect(s.open).toEqual([5, 6, 7]);
    const spots = last(map.dataFor(SPIDER_SOURCE));
    expect(spots.features.map((f) => f.properties!['id'])).toEqual([5, 6, 7]);
    const legs = last(map.dataFor(SPIDER_LEGS_SOURCE));
    expect(legs.features.filter((f) => f.geometry.type === 'LineString')).toHaveLength(3);
    expect(map.setFilter).toHaveBeenCalledWith(PHOTO_IMAGES, ['all', ['!', ['has', 'point_count']], ['!', ['in', ['get', 'id'], ['literal', [5, 6, 7]]]]]);
  });

  it('hides the group disc it was spread from, and shows it again when it closes up', () => {
    const { map, s } = spider();

    s.spread({ lon: 107.17, lat: 10.56 }, pictures, 42);
    expect(map.setFilter).toHaveBeenCalledWith(PHOTO_CLUSTERS, ['all', ['has', 'point_count'], ['!=', ['get', 'cluster_id'], 42]]);

    s.close();
    expect(s.open).toEqual([]);
    expect(map.setFilter).toHaveBeenCalledWith(PHOTO_COUNTS, ['has', 'point_count']);
    expect(map.setFilter).toHaveBeenCalledWith(PHOTO_POINTS, ['!', ['has', 'point_count']]);
    expect(last(map.dataFor(SPIDER_SOURCE)).features).toEqual([]);
  });

  it('does nothing for a single picture, or for the same pictures again', () => {
    const { map, s } = spider();

    s.spread({ lon: 107.17, lat: 10.56 }, pictures.slice(0, 1));
    expect(s.open).toEqual([]);

    s.spread({ lon: 107.17, lat: 10.56 }, pictures);
    const calls = map.dataFor(SPIDER_SOURCE).mock.calls.length;
    s.spread({ lon: 107.17, lat: 10.56 }, [...pictures].reverse());
    expect(map.dataFor(SPIDER_SOURCE).mock.calls.length).toBe(calls);
  });

  /** A spider on a map whose zoom the test sets, drawn without the spring. */
  function zoomable(zoom: number) {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const map = { ...fakeMap(), getZoom: () => zoom };
    for (const id of [PHOTO_CLUSTERS, PHOTO_COUNTS, PHOTO_POINTS, PHOTO_IMAGES]) map.layers.add(id);
    const s = new PhotoSpider(map as never);
    s.addLayers();
    const zoomTo = (z: number) => {
      zoom = z;
      (map.on.mock.calls.find((c) => c[0] === 'zoom')![1] as () => void)();
    };
    /** How far the first spread picture is from the middle, in pixels (the fake map has 1000 to the degree). */
    const reach = () => {
      const [lon, lat] = (last(map.dataFor(SPIDER_SOURCE)).features[0].geometry as unknown as { coordinates: [number, number] }).coordinates;
      return Math.hypot(lon - 107.17, lat - 10.56) * 1000;
    };
    return { map, s, zoomTo, reach };
  }

  it('sizes the spread thumbnails and their ring with the zoom, as single thumbnails are', () => {
    const { map } = spider();
    const layer = (id: string) => map.addLayer.mock.calls.find((c) => c[0].id === id)![0] as { layout?: Record<string, unknown>; paint?: Record<string, unknown> };

    expect(layer(SPIDER_IMAGES).layout!['icon-size']).toEqual(PHOTO_IMAGE_SIZE);
    expect(layer(SPIDER_RING).paint!['circle-radius']).toEqual(PHOTO_THUMBNAIL_RING);
  });

  it('stays spread while the map zooms, springing further out as the thumbnails grow', () => {
    try {
      const { s, zoomTo, reach } = zoomable(16);
      s.spread({ lon: 107.17, lat: 10.56 }, pictures);
      const atUsualSize = reach();

      zoomTo(17);
      expect(s.open).toEqual([5, 6, 7]);
      expect(reach()).toBeCloseTo(atUsualSize);                              // thumbnails keep their size to zoom 18

      zoomTo(20);
      expect(reach()).toBeCloseTo(atUsualSize * 2);                          // and are twice it at 20
      zoomTo(22);
      expect(reach()).toBeCloseTo(atUsualSize * 3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('closes a spread from a numbered group once the zoom passes a whole level, as the groups are numbered afresh', () => {
    try {
      const { s, zoomTo } = zoomable(12.2);
      s.spread({ lon: 107.17, lat: 10.56 }, pictures, 42);

      zoomTo(12.9);
      expect(s.open).toEqual([5, 6, 7]);
      zoomTo(13.1);
      expect(s.open).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rings the open picture among the spread ones', () => {
    const { map, s } = spider();

    s.setSelected(6);

    expect(map.setFilter).toHaveBeenCalledWith(SPIDER_RING, ['==', ['get', 'id'], 6]);
  });

  it('forgets what was spread when a new style is loaded', () => {
    const { s } = spider();
    s.spread({ lon: 107.17, lat: 10.56 }, pictures);

    s.addLayers();

    expect(s.open).toEqual([]);
  });

  it('draws the spread at once, without the spring, for someone who asked for less motion', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      const { map, s } = spider();
      s.spread({ lon: 107.17, lat: 10.56 }, pictures);

      expect(map.dataFor(SPIDER_SOURCE)).toHaveBeenCalledTimes(1);
      const [a, b] = last(map.dataFor(SPIDER_SOURCE)).features.map((f) => (f.geometry as unknown as { coordinates: [number, number] }).coordinates);
      // 1000 pixels to the degree in the fake map: the pictures sit a thumbnail and more apart.
      expect(distance(a, b) * 1000).toBeGreaterThan(SPIDER_SPACING_PX * 0.85);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
