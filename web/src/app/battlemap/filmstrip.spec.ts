import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { MapView } from './basemap.service';
import { render, settle } from './battlemap-testing';
import type { IncidentMediaView } from './community/community';
import { Filmstrip, MAX_IN_STRIP, formatDistance, picturesInView } from './filmstrip';

const pic = (id: number, lat: number | null, lon: number | null, over: Partial<IncidentMediaView> = {}): IncidentMediaView => ({
  id, mediaId: id, contactId: null, url: `/media/aa/${id}.jpg`, thumbUrl: `/media/aa/${id}-480.jpg`, width: 800, height: 600, caption: `Photo ${id}`, credit: null,
  dateTaken: null, lat, lon, status: 'Approved', likes: 0, likedByMe: false, byteSize: 1000, contentType: 'image/jpeg', addedUtc: '2018-09-02T04:15:00Z',
  addedBy: null, mine: false, canRemove: false, ...over,
});

const VIEW: MapView = { west: 107, south: 10.4, east: 107.4, north: 10.8, lat: 10.6, lon: 107.2 };
const A = pic(1, 10.6, 107.2);            // in the middle
const B = pic(2, 10.61, 107.2);           // about 1.1 km north
const C = pic(3, 10.5, 107.2);            // about 11 km south
const OUT = pic(4, 12, 107.2);            // outside the view
const UNPLACED = pic(5, null, null);
const ALL = [C, OUT, B, UNPLACED, A];

describe('picturesInView', () => {
  it('keeps the pictures inside the view, nearest the middle first', () => {
    expect(picturesInView(ALL, VIEW).map((v) => v.picture.id)).toEqual([1, 2, 3]);
  });

  it('measures the distance from the middle of the view', () => {
    const [a, b, c] = picturesInView(ALL, VIEW);

    expect(a.metres).toBe(0);
    expect(b.metres).toBeGreaterThan(1050);
    expect(b.metres).toBeLessThan(1170);
    expect(c.metres).toBeGreaterThan(11_000);
    expect(c.metres).toBeLessThan(11_300);
  });

  it('follows the middle of the view as it moves', () => {
    const south = { ...VIEW, lat: 10.5 };

    expect(picturesInView(ALL, south).map((v) => v.picture.id)).toEqual([3, 1, 2]);
  });

  it('takes east and west into account, narrowed by the latitude', () => {
    const east = pic(6, 10.6, 107.21);        // about 1.1 km east, about the same as B is north
    const order = picturesInView([east, B, A], VIEW).map((v) => v.picture.id);

    expect(order[0]).toBe(1);
    expect(Math.abs(picturesInView([east], VIEW)[0].metres - picturesInView([B], VIEW)[0].metres)).toBeLessThan(40);
  });

  it('settles a tie by id, and copes with no view and no pictures', () => {
    const twin = pic(9, 10.61, 107.2);

    expect(picturesInView([twin, B], VIEW).map((v) => v.picture.id)).toEqual([2, 9]);
    expect(picturesInView(ALL, null)).toEqual([]);
    expect(picturesInView([], VIEW)).toEqual([]);
  });

  it('holds no more than a strip can, keeping the nearest', () => {
    const many = Array.from({ length: MAX_IN_STRIP + 25 }, (_, i) => pic(100 + i, 10.6 + i * 0.0001, 107.2));
    const strip = picturesInView(many, VIEW);

    expect(strip).toHaveLength(MAX_IN_STRIP);
    expect(strip[0].picture.id).toBe(100);
  });
});

describe('formatDistance', () => {
  it('gives metres to the nearest ten below a kilometre, and kilometres above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(847)).toBe('850 m');
    expect(formatDistance(1130)).toBe('1.1 km');
    expect(formatDistance(11_200)).toBe('11 km');
  });
});

describe('Filmstrip', () => {
  function setup(inputs: Record<string, unknown> = {}) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const f = TestBed.createComponent(Filmstrip);
    f.componentRef.setInput('items', picturesInView(ALL, VIEW));
    for (const [k, v] of Object.entries(inputs)) {
      f.componentRef.setInput(k, v);
    }
    const picked = vi.fn();
    f.componentInstance.picked.subscribe(picked);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const thumbs = () => [...el.querySelectorAll<HTMLButtonElement>('.thumb')];
    const arrow = () => el.querySelector<HTMLButtonElement>('.film__toggle')!;
    return { f, el, thumbs, arrow, picked };
  }

  it('shows nothing at all when no photo is in view', () => {
    const { el } = setup({ items: [] });

    expect(el.querySelector('.film')).toBeNull();
  });

  it('is a narrow column of thumbnails to begin with, nearest first, with their number', () => {
    const { el, thumbs } = setup();

    expect(thumbs()).toHaveLength(3);
    expect(thumbs().map((t) => t.querySelector('img')!.getAttribute('src'))).toEqual(['/media/aa/1-480.jpg', '/media/aa/2-480.jpg', '/media/aa/3-480.jpg']);
    expect(el.querySelector('.film')!.classList.contains('is-wide')).toBe(false);
    expect(el.querySelector('.film__count')!.textContent).toContain('3');
    expect(el.querySelector('.thumb__caption')).toBeNull();
  });

  it('names each thumbnail for a screen reader, with how far it is', () => {
    const { thumbs } = setup();

    expect(thumbs()[0].getAttribute('aria-label')).toBe('Photo 1, 0 m');
    expect(thumbs()[1].getAttribute('aria-label')).toMatch(/^Photo 2, 1\.1 km$/);
    expect(thumbs()[0].querySelector('img')!.getAttribute('alt')).toBe('');
  });

  it('has an arrow that makes it wider, showing each caption and how far away it is, and narrower again', () => {
    const { f, el, thumbs, arrow } = setup({ items: picturesInView([pic(1, 10.6, 107.2, { credit: 'AWM' }), B], VIEW) });
    expect(arrow().getAttribute('aria-expanded')).toBe('false');
    expect(arrow().getAttribute('aria-label')).toBe('Make the photo strip wider');

    arrow().click();
    f.detectChanges();

    expect(f.componentInstance.expanded()).toBe(true);
    expect(el.querySelector('.film')!.classList.contains('is-wide')).toBe(true);
    expect(arrow().getAttribute('aria-expanded')).toBe('true');
    expect(arrow().getAttribute('aria-label')).toBe('Make the photo strip narrower');
    expect(thumbs()[0].querySelector('.thumb__caption')!.textContent).toBe('Photo 1');
    expect(thumbs()[0].querySelector('.thumb__meta')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('0 m · AWM');
    expect(el.querySelector('.film__count')!.textContent).toContain('2 photos in view, nearest first');

    arrow().click();
    f.detectChanges();
    expect(f.componentInstance.expanded()).toBe(false);
  });

  it('can start wide', () => {
    const { el } = setup({ expanded: true });

    expect(el.querySelector('.film')!.classList.contains('is-wide')).toBe(true);
  });

  it('tells the map which photo was chosen', () => {
    const { thumbs, picked } = setup();

    thumbs()[1].click();

    expect(picked).toHaveBeenCalledExactlyOnceWith(B);
  });

  it('marks the photo that is open', () => {
    const { thumbs } = setup({ selectedId: 2 });

    expect(thumbs().map((t) => t.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(thumbs()[1].classList.contains('is-on')).toBe(true);
  });

  it('describes a photo with no caption as a photo', () => {
    const { thumbs } = setup({ items: picturesInView([pic(1, 10.6, 107.2, { caption: null })], VIEW), expanded: true });

    expect(thumbs()[0].querySelector('.thumb__caption')!.textContent).toBe('Photo');
  });
});

describe('the photo strip on the Battle Map', () => {
  const withPictures = (list: IncidentMediaView[]) => ({ community: { mediaOnMap: vi.fn(() => Promise.resolve(list)) } });
  const thumbs = (r: Awaited<ReturnType<typeof render>>) => [...r.el.querySelectorAll<HTMLButtonElement>('app-filmstrip .thumb')];
  const ids = (r: Awaited<ReturnType<typeof render>>) => thumbs(r).map((t) => t.querySelector('img')!.getAttribute('src')!.match(/(\d+)-480/)![1]);

  it('shows the photos in the view, nearest the middle first, and follows the view as it moves', async () => {
    const r = await render(withPictures(ALL.filter((p) => p.lat !== null)));
    expect(thumbs(r)).toHaveLength(0);                                 // the map has not said where it is looking yet

    r.basemaps.view.set(VIEW);
    await settle(r.fixture);
    expect(ids(r)).toEqual(['1', '2', '3']);

    r.basemaps.view.set({ ...VIEW, lat: 10.5 });
    await settle(r.fixture);
    expect(ids(r)).toEqual(['3', '1', '2']);

    r.basemaps.view.set({ west: 108, south: 11, east: 109, north: 12, lat: 11.5, lon: 108.5 });       // somewhere with no photos
    await settle(r.fixture);
    expect(r.el.querySelector('app-filmstrip .film')).toBeNull();
  });

  it('opens the photo that is chosen, and rings it on the map', async () => {
    const r = await render(withPictures([A, B, C]));
    r.basemaps.view.set(VIEW);
    await settle(r.fixture);

    thumbs(r)[1].click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-panel')).not.toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(B.lat, B.lon, 14);
    expect(r.basemaps.map.setFilter).toHaveBeenCalledWith('avw-photos-selected', ['==', ['get', 'id'], 2]);
    expect(thumbs(r)[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('is hidden when the photos are switched off on the map', async () => {
    const r = await render(withPictures([A, B]));
    r.basemaps.view.set(VIEW);
    await settle(r.fixture);
    expect(thumbs(r)).toHaveLength(2);

    [...r.el.querySelectorAll<HTMLLabelElement>('#tabpanel label')].find((l) => l.textContent?.includes('Community photos'))!.querySelector('input')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-filmstrip .film')).toBeNull();
    expect(r.el.querySelector('.bm')!.classList.contains('bm--film')).toBe(false);
  });

  it('makes room for what shares its edge, wider when it is wide', async () => {
    const r = await render(withPictures([A, B]));
    r.basemaps.view.set(VIEW);
    await settle(r.fixture);
    const bm = r.el.querySelector('.bm')!;
    expect(bm.classList.contains('bm--film')).toBe(true);
    expect(bm.classList.contains('bm--film-wide')).toBe(false);

    r.el.querySelector<HTMLButtonElement>('app-filmstrip .film__toggle')!.click();
    await settle(r.fixture);

    expect(bm.classList.contains('bm--film-wide')).toBe(true);
  });
});
