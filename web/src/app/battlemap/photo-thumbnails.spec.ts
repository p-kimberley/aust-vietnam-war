import { STACK_BADGES, STACK_COUNTS } from './photo-stacks';
import { describe, expect, it, vi } from 'vitest';
import { render, settle } from './battlemap-testing';
import type { IncidentMediaView } from './community/community';
import {
  PHOTO_CLUSTERS,
  PHOTO_FADE_START,
  PHOTO_FULL_ZOOM,
  PHOTO_GROWTH_PER_ZOOM,
  PHOTO_GROW_FROM,
  PHOTO_IMAGES,
  PHOTO_POINTS,
  PHOTO_SELECTED,
  PHOTO_SOURCE,
  addPhotoLayers,
  setPhotoVisibility,
  thumbnailScale,
} from './photo-layers';
import { PHOTO_IMAGE_PREFIX, PHOTO_THUMB_PX, frameThumbnail, registerPhotoThumbnails } from './photo-thumbnails';

const pic = (id: number, over: Partial<IncidentMediaView> = {}): IncidentMediaView => ({
  id, mediaId: id, contactId: null, url: `/media/aa/${id}.jpg`, thumbUrl: `/media/aa/${id}-480.jpg`, width: 800, height: 600, caption: `Photo ${id}`, credit: null,
  dateTaken: null, lat: 10.6, lon: 107.2, status: 'Approved', likes: 0, likedByMe: false, byteSize: 1000, contentType: 'image/jpeg', addedUtc: '2018-09-02T04:15:00Z',
  addedBy: null, mine: false, canRemove: false, ...over,
});

function fake() {
  const layers = new Map<string, Record<string, unknown>>();
  const sources = new Map<string, Record<string, unknown>>();
  const handlers: Record<string, (e: { id: string }) => void> = {};
  const images = new Set<string>();
  return {
    layers,
    sources,
    handlers,
    images,
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    getLayer: (id: string) => layers.get(id),
    addSource: vi.fn((id: string, spec: Record<string, unknown>) => void sources.set(id, spec)),
    addLayer: vi.fn((l: { id: string }) => void layers.set(l.id, l)),
    setLayoutProperty: vi.fn(),
    setFilter: vi.fn(),
    on: vi.fn((event: string, handler: (e: { id: string }) => void) => void (handlers[event] = handler)),
    hasImage: (id: string) => images.has(id),
    addImage: vi.fn((id: string, _image?: unknown, _options?: unknown) => void images.add(id)),
  };
}

describe('the zoom levels of the thumbnails', () => {
  it('start to fade in at 14 and are fully there at 15', () => {
    expect(PHOTO_FADE_START).toBe(14);
    expect(PHOTO_FULL_ZOOM).toBe(15);
  });

  it('keep their size up to zoom 18 and grow in a straight line from there', () => {
    expect(PHOTO_GROW_FROM).toBe(18);
    expect(thumbnailScale(14)).toBe(1);
    expect(thumbnailScale(18)).toBe(1);
    expect(thumbnailScale(19)).toBeCloseTo(1 + PHOTO_GROWTH_PER_ZOOM, 6);
    expect(thumbnailScale(20) - thumbnailScale(19)).toBeCloseTo(thumbnailScale(21) - thumbnailScale(20), 6);
    expect(thumbnailScale(22)).toBeCloseTo(1 + 4 * PHOTO_GROWTH_PER_ZOOM, 6);
  });

  it('are about three quarters of the size of the thumbnails that were in the strip', () => {
    expect(PHOTO_THUMB_PX / 67).toBeGreaterThan(0.7);
    expect(PHOTO_THUMB_PX / 67).toBeLessThan(0.8);
  });
});

describe('the photo image layer', () => {
  const add = (visible = true, selectedId: number | null = null) => {
    const map = fake();
    addPhotoLayers(map as never, [pic(1), pic(2)], { visible, selectedId });
    return map;
  };

  it('is a layer of images above the plain markers and below the ring', () => {
    const map = add();

    expect([...map.layers.keys()]).toEqual([PHOTO_CLUSTERS, 'avw-photos-counts', PHOTO_POINTS, PHOTO_IMAGES, PHOTO_SELECTED, STACK_BADGES, STACK_COUNTS]);
    expect(map.layers.get(PHOTO_IMAGES)).toMatchObject({ type: 'symbol', source: PHOTO_SOURCE, minzoom: 14, filter: ['!', ['has', 'point_count']] });
  });

  it('draws each picture from its own image, all of them, however close together', () => {
    const layout = add().layers.get(PHOTO_IMAGES)!['layout'] as Record<string, unknown>;

    expect(layout['icon-image']).toEqual(['concat', PHOTO_IMAGE_PREFIX, ['to-string', ['get', 'id']]]);
    expect(layout['icon-allow-overlap']).toBe(true);
    expect(layout['icon-ignore-placement']).toBe(true);
  });

  it('fades in from zoom 14 to full at 15, as the plain marker fades out', () => {
    const map = add();
    const image = (map.layers.get(PHOTO_IMAGES)!['paint'] as Record<string, unknown>)['icon-opacity'];
    const dot = map.layers.get(PHOTO_POINTS)!['paint'] as Record<string, unknown>;

    expect(image).toEqual(['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1]);
    expect(dot['circle-opacity']).toEqual(['interpolate', ['linear'], ['zoom'], 14, 1, 15, 0]);
    expect(dot['circle-stroke-opacity']).toEqual(dot['circle-opacity']);
  });

  it('keeps its size to zoom 18 and grows in a straight line after it', () => {
    const size = (add().layers.get(PHOTO_IMAGES)!['layout'] as Record<string, unknown>)['icon-size'];

    expect(size).toEqual(['interpolate', ['linear'], ['zoom'], 18, 1, 22, thumbnailScale(22)]);
  });

  it('groups pictures only up to zoom 13, so that they are single by 14', () => {
    expect(add().sources.get(PHOTO_SOURCE)).toMatchObject({ cluster: true, clusterMaxZoom: 13 });
  });

  it('has the ring go round a thumbnail, growing with it', () => {
    const radius = (add().layers.get(PHOTO_SELECTED)!['paint'] as Record<string, unknown>)['circle-radius'] as unknown[];

    expect(radius.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    expect(radius.at(-1)).toBeCloseTo(34 * thumbnailScale(22), 6);
    expect(radius).toContain(34);
  });

  it('is shown and hidden with the rest of the photos', () => {
    const off = add(false);
    expect((off.layers.get(PHOTO_IMAGES)!['layout'] as { visibility: string }).visibility).toBe('none');

    const on = add(true);
    setPhotoVisibility(on as never, false);
    expect(on.setLayoutProperty).toHaveBeenCalledWith(PHOTO_IMAGES, 'visibility', 'none');
  });
});

/** A canvas that draws nothing, but records how it was asked to draw and how big it was made. */
function stubCanvas() {
  const calls: { drawImage?: number[] } = {};
  const size = { width: 300, height: 150 };
  const ctx = new Proxy(
    {},
    {
      get: (_t, name) => {
        if (name === 'drawImage') return (_i: unknown, ...a: number[]) => void (calls.drawImage = a);
        if (name === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        return vi.fn();
      },
      set: () => true,
    },
  );
  const spies = [
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never),
    vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set').mockImplementation((v: number) => void (size.width = v)),
    vi.spyOn(HTMLCanvasElement.prototype, 'height', 'set').mockImplementation((v: number) => void (size.height = v)),
    vi.spyOn(HTMLCanvasElement.prototype, 'width', 'get').mockImplementation(() => size.width),
    vi.spyOn(HTMLCanvasElement.prototype, 'height', 'get').mockImplementation(() => size.height),
  ];
  return { calls, size, restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

/** An `Image` that answers at once: as a picture of the given size, or as one that could not be fetched. */
function stubImage(outcome: { width: number; height: number } | 'fails') {
  const made: string[] = [];
  vi.stubGlobal(
    'Image',
    class {
      decoding = '';
      naturalWidth = outcome === 'fails' ? 0 : outcome.width;
      naturalHeight = outcome === 'fails' ? 0 : outcome.height;
      onload?: () => void;
      onerror?: () => void;
      set src(url: string) {
        made.push(url);
        queueMicrotask(() => (outcome === 'fails' ? this.onerror?.() : this.onload?.()));
      }
    },
  );
  return made;
}

describe('frameThumbnail', () => {
  it('scales the picture to the thumbnail size on its long edge, at twice the density, keeping its shape', () => {
    const c = stubCanvas();
    try {
      const data = frameThumbnail({ image: {} as CanvasImageSource, width: 800, height: 600 });

      const [, , w, h] = c.calls.drawImage!;
      expect(w).toBe(PHOTO_THUMB_PX * 2);
      expect(h).toBe(PHOTO_THUMB_PX * 1.5);
      expect(data).not.toBeNull();
      // The frame and the shadow make the drawing a little larger than the picture, evenly, so its middle is the picture's middle.
      expect(data!.width).toBe(w + 2 * (3 + 3) * 2);
      expect(data!.height).toBe(h + 2 * (3 + 3) * 2);
    } finally {
      c.restore();
    }
  });

  it('gives nothing for a picture with no size, or where there is no canvas', () => {
    expect(frameThumbnail({ image: {} as CanvasImageSource, width: 0, height: 0 })).toBeNull();
    expect(frameThumbnail({ image: {} as CanvasImageSource, width: 800, height: 600 })).toBeNull();   // jsdom has no canvas
  });
});

describe('registerPhotoThumbnails', () => {
  it('asks the map to tell it when an image is missing, once however often the pictures change', () => {
    const map = fake();

    registerPhotoThumbnails(map as never, [pic(1)]);
    registerPhotoThumbnails(map as never, [pic(2)]);

    expect(map.on).toHaveBeenCalledTimes(1);
    expect(map.on).toHaveBeenCalledWith('styleimagemissing', expect.any(Function));
  });

  it('ignores an image that is not a picture thumbnail', async () => {
    const map = fake();
    registerPhotoThumbnails(map as never, [pic(1)]);

    map.handlers['styleimagemissing']({ id: 'avw-poi-fsb' });
    await Promise.resolve();

    expect(map.addImage).not.toHaveBeenCalled();
  });

  it('puts a blank in for a thumbnail that cannot be drawn, so the map stops asking for it', async () => {
    const map = fake();
    registerPhotoThumbnails(map as never, [pic(7)]);

    stubImage('fails');
    try {
      map.handlers['styleimagemissing']({ id: `${PHOTO_IMAGE_PREFIX}7` });                    // its file cannot be fetched
      map.handlers['styleimagemissing']({ id: `${PHOTO_IMAGE_PREFIX}99` });                   // a picture it was never told about
      await new Promise((r) => setTimeout(r, 20));

      expect(map.addImage.mock.calls.map((c) => c[0]).sort()).toEqual([`${PHOTO_IMAGE_PREFIX}7`, `${PHOTO_IMAGE_PREFIX}99`]);
      expect(map.addImage.mock.calls[0][1]).toMatchObject({ width: 1, height: 1 });
      expect(map.addImage.mock.calls[0][2]).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fetches a thumbnail when the map first asks for it, draws it as a framed print at twice the density, and keeps it', async () => {
    const map = fake();
    registerPhotoThumbnails(map as never, [pic(21)]);
    const canvas = stubCanvas();
    const fetched = stubImage({ width: 800, height: 600 });
    try {
      map.handlers['styleimagemissing']({ id: `${PHOTO_IMAGE_PREFIX}21` });
      await new Promise((r) => setTimeout(r, 20));

      expect(fetched).toEqual(['/media/aa/21-480.jpg']);
      expect(map.addImage).toHaveBeenCalledTimes(1);
      expect(map.addImage.mock.calls[0][0]).toBe(`${PHOTO_IMAGE_PREFIX}21`);
      expect(map.addImage.mock.calls[0][2]).toEqual({ pixelRatio: 2 });
      expect((map.addImage.mock.calls[0][1] as ImageData).width).toBeGreaterThan(PHOTO_THUMB_PX * 2);

      // Switching basemap discards the images. The map asks again, and the drawing kept is used, not fetched again.
      map.images.clear();
      map.handlers['styleimagemissing']({ id: `${PHOTO_IMAGE_PREFIX}21` });
      await new Promise((r) => setTimeout(r, 20));
      expect(map.addImage).toHaveBeenCalledTimes(2);
      expect(fetched).toHaveLength(1);
    } finally {
      canvas.restore();
      vi.unstubAllGlobals();
    }
  });

  it('fetches a thumbnail once when it is asked for twice before it arrives', async () => {
    const map = fake();
    registerPhotoThumbnails(map as never, [pic(31)]);
    const canvas = stubCanvas();
    const fetched = stubImage({ width: 400, height: 400 });
    try {
      map.handlers['styleimagemissing']({ id: `${PHOTO_IMAGE_PREFIX}31` });
      map.handlers['styleimagemissing']({ id: `${PHOTO_IMAGE_PREFIX}31` });
      await new Promise((r) => setTimeout(r, 20));

      expect(fetched).toHaveLength(1);
    } finally {
      canvas.restore();
      vi.unstubAllGlobals();
    }
  });

  it('does not add an image the map already has', async () => {
    const map = fake();
    registerPhotoThumbnails(map as never, [pic(3)]);
    map.images.add(`${PHOTO_IMAGE_PREFIX}3`);

    map.handlers['styleimagemissing']({ id: `${PHOTO_IMAGE_PREFIX}3` });
    await new Promise((r) => setTimeout(r, 20));

    expect(map.addImage).not.toHaveBeenCalled();
  });
});

describe('the photo thumbnails on the Battle Map', () => {
  const withPictures = { community: { mediaOnMap: vi.fn(() => Promise.resolve([pic(5, { lat: 10.56, lon: 107.17 }), pic(6, { lat: 10.6, lon: 107.2 })])) } };

  it('opens the picture when its thumbnail is clicked', async () => {
    const r = await render(withPictures);

    r.basemaps.handlers.get(PHOTO_IMAGES)!({ id: 6 });
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-viewer')).not.toBeNull();
    expect(r.basemaps.map.setFilter).toHaveBeenCalledWith(PHOTO_SELECTED, ['==', ['get', 'id'], 6]);
  });

  it('counts a click on a thumbnail as a click on a picture, not on empty map', async () => {
    const r = await render(withPictures);

    expect(r.basemaps.bindBackgroundClick.mock.calls[0][0]).toContain(PHOTO_IMAGES);
  });

  it('brings a picture opened from a search or a list close enough to see it in full', async () => {
    const r = await render(withPictures);
    r.el.querySelector<HTMLElement>('app-search-box');                                   // (opened through the same method)
    (r.fixture.componentInstance as unknown as { openPictureAt(p: { id: number; lat: number; lon: number }): void }).openPictureAt({ id: 5, lat: 10.56, lon: 107.17 });
    await settle(r.fixture);

    expect(r.basemaps.flyTo).toHaveBeenCalledWith(10.56, 107.17, PHOTO_FULL_ZOOM);
  });
});
