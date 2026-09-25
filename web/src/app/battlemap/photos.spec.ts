import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { render, settle } from './battlemap-testing';
import { CommunityService, IncidentMediaView } from './community/community';
import { communityProviders, fakeAuth, fakeCommunity } from './community/community-testing';
import {
  PHOTO_CLUSTERS,
  PHOTO_IMAGES,
  PHOTO_COUNTS,
  PHOTO_POINTS,
  PHOTO_SELECTED,
  PHOTO_SOURCE,
  addPhotoLayers,
  setPhotoVisibility,
  setSelectedPhoto,
  toPhotoGeoJson,
  zoomIntoCluster,
} from './photo-layers';
import { PictureViewer, formatBytes, formatType } from './picture-viewer';
import { SPIDER_IMAGES, SPIDER_RING, SPIDER_SOURCE } from './photo-spider';
import type { FeatureCollection } from 'geojson';

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

const pic = (over: Partial<IncidentMediaView> = {}): IncidentMediaView => ({
  id: 5,
  mediaId: 1,
  contactId: null,
  url: '/media/aa/full.jpg',
  thumbUrl: '/media/aa/full-480.jpg',
  width: 800,
  height: 600,
  caption: 'A patrol at Nui Dat',
  credit: 'AWM',
  dateTaken: '1966-08-18',
  lat: 10.56,
  lon: 107.17,
  status: 'Approved',
  likes: 3,
  likedByMe: false,
  byteSize: 183_500,
  contentType: 'image/jpeg',
  addedUtc: '2018-09-02T04:15:00Z',
  addedBy: 'Alex Member',
  mine: false,
  canRemove: false,
  ...over,
});

const PICS = [pic(), pic({ id: 6, contactId: 2, lat: 10.6, lon: 107.2 }), pic({ id: 7, lat: null, lon: null })];

describe('toPhotoGeoJson', () => {
  it('draws only the pictures that have a place, with [lon, lat] coordinates', () => {
    const fc = toPhotoGeoJson(PICS);

    expect(fc.features.map((f) => f.properties.id)).toEqual([5, 6]);
    expect(fc.features[0].geometry.coordinates).toEqual([107.17, 10.56]);
    expect(fc.features[1].id).toBe(6);
  });
});

describe('photo layers', () => {
  function fake() {
    const sources = new Map<string, Record<string, unknown>>();
    const layers = new Map<string, Record<string, unknown>>();
    const expansion = vi.fn(() => Promise.resolve(11));
    return {
      sources,
      layers,
      expansion,
      getSource: (id: string) => (sources.has(id) ? { getClusterExpansionZoom: expansion } : undefined),
      getLayer: (id: string) => layers.get(id),
      addSource: vi.fn((id: string, spec: Record<string, unknown>) => void sources.set(id, spec)),
      addLayer: vi.fn((l: { id: string }) => void layers.set(l.id, l)),
      setLayoutProperty: vi.fn(),
      setFilter: vi.fn(),
      easeTo: vi.fn(),
      on: vi.fn(),
      hasImage: vi.fn(() => false),
      addImage: vi.fn(),
    };
  }

  it('adds a grouping source, group discs and counts, single markers and a selection ring, once', () => {
    const map = fake();

    addPhotoLayers(map as never, PICS, { visible: true, selectedId: null });
    addPhotoLayers(map as never, PICS, { visible: true, selectedId: null });

    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.sources.get(PHOTO_SOURCE)).toMatchObject({ type: 'geojson', cluster: true });
    expect([...map.layers.keys()]).toEqual([PHOTO_CLUSTERS, PHOTO_COUNTS, PHOTO_POINTS, 'avw-photos-images', PHOTO_SELECTED]);
    expect(map.layers.get(PHOTO_CLUSTERS)!['filter']).toEqual(['has', 'point_count']);
    expect(map.layers.get(PHOTO_POINTS)!['filter']).toEqual(['!', ['has', 'point_count']]);
  });

  it('starts hidden when the layer is off, and rings the open picture only while shown', () => {
    const off = fake();
    addPhotoLayers(off as never, PICS, { visible: false, selectedId: 5 });
    expect((off.layers.get(PHOTO_POINTS)!['layout'] as { visibility: string }).visibility).toBe('none');
    expect(off.layers.get(PHOTO_SELECTED)!['filter']).toEqual(['==', ['get', 'id'], -1]);

    const on = fake();
    addPhotoLayers(on as never, PICS, { visible: true, selectedId: 5 });
    expect(on.layers.get(PHOTO_SELECTED)!['filter']).toEqual(['==', ['get', 'id'], 5]);
  });

  it('shows and hides markers, groups and counts together, dropping the ring when hidden', () => {
    const map = fake();
    addPhotoLayers(map as never, PICS, { visible: true, selectedId: 5 });

    setPhotoVisibility(map as never, false);

    for (const id of [PHOTO_CLUSTERS, PHOTO_COUNTS, PHOTO_POINTS]) {
      expect(map.setLayoutProperty).toHaveBeenCalledWith(id, 'visibility', 'none');
    }
    expect(map.setFilter).toHaveBeenCalledWith(PHOTO_SELECTED, ['==', ['get', 'id'], -1]);
  });

  it('rings a picture, or clears the ring', () => {
    const map = fake();
    addPhotoLayers(map as never, PICS, { visible: true, selectedId: null });

    setSelectedPhoto(map as never, 6);
    setSelectedPhoto(map as never, null);

    expect(map.setFilter.mock.calls).toEqual([
      [PHOTO_SELECTED, ['==', ['get', 'id'], 6]],
      [PHOTO_SELECTED, ['==', ['get', 'id'], -1]],
    ]);
  });

  it('zooms in on a group until it breaks up, centred where it was clicked', async () => {
    const map = fake();
    addPhotoLayers(map as never, PICS, { visible: true, selectedId: null });

    await zoomIntoCluster(map as never, 42, { lon: 107.2, lat: 10.6 });

    expect(map.expansion).toHaveBeenCalledWith(42);
    expect(map.easeTo).toHaveBeenCalledWith({ center: [107.2, 10.6], zoom: 11.5, duration: 600 });
  });
});

describe('CommunityService pictures on the map', () => {
  function setup() {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    return { ctl: TestBed.inject(HttpTestingController), service: TestBed.inject(CommunityService) };
  }

  it('asks for every picture that has a place', async () => {
    const { ctl, service } = setup();
    const result = service.mediaOnMap();

    const req = ctl.expectOne((r) => r.url === '/api/community-media');
    expect(req.request.params.toString()).toBe('minLat=-90&minLon=-180&maxLat=90&maxLon=180');
    req.flush(PICS);

    expect(await result).toEqual(PICS);
  });

  it('gives one picture, null when there is none for this person, and an error for anything else', async () => {
    const { ctl, service } = setup();

    const found = service.mediaDetail(5);
    ctl.expectOne('/api/incident-media/5').flush(pic());
    expect((await found)!.id).toBe(5);

    const missing = service.mediaDetail(9);
    ctl.expectOne('/api/incident-media/9').flush(null, { status: 404, statusText: 'Not Found' });
    expect(await missing).toBeNull();

    const broken = service.mediaDetail(7);
    ctl.expectOne('/api/incident-media/7').flush('x', { status: 500, statusText: 'Server Error' });
    await expect(broken).rejects.toBeInstanceOf(HttpErrorResponse);
  });
});

describe('PictureViewer', () => {
  function viewer(over: Record<string, unknown> = {}, user: Parameters<typeof fakeAuth>[0] = {}) {
    TestBed.resetTestingModule();
    const community = fakeCommunity({ mediaDetail: vi.fn(() => Promise.resolve(pic())), ...over });
    const auth = fakeAuth(user);
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...communityProviders(community, auth)] });
    const fixture = TestBed.createComponent(PictureViewer);
    fixture.componentRef.setInput('pictureId', 5);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    return { fixture, community, auth, el: fixture.nativeElement as HTMLElement };
  }
  /** What the side panel says against one of its headings. */
  const field = (el: HTMLElement, name: string) => {
    const dt = [...el.querySelectorAll('dt')].find((d) => text(d) === name);
    return dt ? text(dt.nextElementSibling) : undefined;
  };
  const button = (el: HTMLElement, label: string) => [...el.querySelectorAll('button')].find((b) => text(b) === label || b.getAttribute('aria-label') === label)!;

  it('is a modal dialog, named by the caption, with the full picture beside what is known of it', async () => {
    const { fixture, el } = viewer();
    await settle(fixture);

    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(text(el.querySelector('#' + dialog.getAttribute('aria-labelledby')))).toBe('A patrol at Nui Dat');
    const img = el.querySelector('.stage img')!;
    expect(img.getAttribute('src')).toBe('/media/aa/full.jpg');
    expect(img.getAttribute('alt')).toBe('A patrol at Nui Dat');
    expect(el.querySelector('.side')).not.toBeNull();
    expect(field(el, 'Credit')).toBe('AWM');
    expect(field(el, 'Taken')).toBe('18 Aug 1966');
    expect(field(el, 'Likes')).toBe('3');
    expect(el.querySelector('a[target=_blank]')).toBeNull();                          // nothing opens another tab
  });

  it('shows what was recorded when it was uploaded: who added it, when, where, and the size and kind of file', async () => {
    const { fixture, el } = viewer({ mediaDetail: vi.fn(() => Promise.resolve(pic({ contactId: 2 }))) });
    await settle(fixture);

    expect(field(el, 'Added by')).toBe('Alex Member');
    expect(field(el, 'Added')).toBe('2 Sep 2018');
    expect(field(el, 'Location')).toBe('10.56000, 107.17000');
    expect(field(el, 'Image')).toBe('800 × 600 px · 179.2 KB · JPG');
    expect(field(el, 'Incident')).toBe('2');
  });

  it('leaves out what it does not have, and describes a picture with no caption', async () => {
    const { fixture, el } = viewer({ mediaDetail: vi.fn(() => Promise.resolve(pic({ caption: null, credit: null, dateTaken: null, addedBy: null, lat: null, lon: null }))) });
    await settle(fixture);

    for (const name of ['Credit', 'Taken', 'Added by', 'Location', 'Incident']) {
      expect(field(el, name)).toBeUndefined();
    }
    expect(text(el.querySelector('h2'))).toBe('Photo');
    expect(el.querySelector('.stage img')?.getAttribute('alt')).toBe('A photo placed on the map');
  });

  it('says a picture is waiting for approval, and offers no like on it', async () => {
    const { fixture, el } = viewer({ mediaDetail: vi.fn(() => Promise.resolve(pic({ status: 'Pending', mine: true }))) }, { authenticated: true, roles: ['member'] });
    await settle(fixture);

    expect(text(el.querySelector('.side__badge'))).toBe('Waiting for approval');
    expect(el.querySelector('[aria-pressed]')).toBeNull();
  });

  it('writes a file size and a kind of file for a person', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
    expect(formatType('image/jpeg')).toBe('JPG');
    expect(formatType('image/png')).toBe('PNG');
    expect(formatType('image/webp')).toBe('WEBP');
  });

  it('asks a visitor to sign in, and offers a like to a member', async () => {
    const visitor = viewer();
    await settle(visitor.fixture);
    expect(text(visitor.el)).toContain('Sign in to like a photo');
    expect(visitor.el.querySelector('[aria-pressed]')).toBeNull();
    button(visitor.el, 'Sign in').click();
    expect(visitor.auth.login).toHaveBeenCalled();

    const member = viewer({}, { authenticated: true, roles: ['member'] });
    await settle(member.fixture);
    expect(text(member.el)).toContain('Like this photo');
  });

  it('likes and unlikes, showing the new count', async () => {
    const toggleLike = vi.fn().mockResolvedValueOnce({ likes: 4, liked: true }).mockResolvedValueOnce({ likes: 3, liked: false });
    const { fixture, el } = viewer({ toggleLike }, { authenticated: true, roles: ['member'] });
    await settle(fixture);
    const like = () => el.querySelector<HTMLButtonElement>('[aria-pressed]')!;

    like().click();
    await settle(fixture);
    expect(toggleLike).toHaveBeenCalledWith(5);
    expect(field(el, 'Likes')).toBe('4');
    expect(like().getAttribute('aria-pressed')).toBe('true');

    like().click();
    await settle(fixture);
    expect(field(el, 'Likes')).toBe('3');
    expect(like().getAttribute('aria-pressed')).toBe('false');
  });

  it('says so when a like cannot be saved', async () => {
    const { fixture, el } = viewer({ toggleLike: vi.fn(() => Promise.reject(new Error('down'))) }, { authenticated: true, roles: ['member'] });
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('[aria-pressed]')!.click();
    await settle(fixture);

    expect(text(el.querySelector('[role=alert]'))).toContain('could not be saved');
    expect(field(el, 'Likes')).toBe('3');
  });

  it('offers the incident only when the picture belongs to one', async () => {
    const none = viewer();
    await settle(none.fixture);
    expect(text(none.el)).not.toContain('Open the incident');

    const attached = viewer({ mediaDetail: vi.fn(() => Promise.resolve(pic({ contactId: 2 }))) });
    const opened: number[] = [];
    attached.fixture.componentInstance.openIncident.subscribe((id) => opened.push(id));
    await settle(attached.fixture);
    button(attached.el, 'Open the incident').click();

    expect(opened).toEqual([2]);
  });

  it('says so when there is no such picture, and offers a retry when loading fails', async () => {
    const missing = viewer({ mediaDetail: vi.fn(() => Promise.resolve(null)) });
    await settle(missing.fixture);
    expect(text(missing.el)).toContain('not found');

    const broken = viewer({ mediaDetail: vi.fn(() => Promise.reject(new Error('down'))) });
    await settle(broken.fixture);
    expect(text(broken.el.querySelector('[role=alert]'))).toContain('could not be loaded');
  });

  it('closes from its close button, Escape, or a click on the dim around it, but not a click inside it', async () => {
    const { fixture, el } = viewer();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    await settle(fixture);

    el.querySelector<HTMLElement>('.side')!.click();
    expect(closed).toBe(0);
    button(el, 'Close the photo').click();
    expect(closed).toBe(1);
    el.querySelector('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(2);
    el.querySelector<HTMLElement>('.viewer')!.click();
    expect(closed).toBe(3);
  });

  it('takes focus onto its close button, and keeps Tab inside the dialog', async () => {
    const { fixture, el } = viewer();
    await settle(fixture);

    expect(document.activeElement).toBe(button(el, 'Close the photo'));
    const buttons = [...el.querySelectorAll<HTMLElement>('[role=dialog] button')];
    buttons[buttons.length - 1].focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    el.querySelector('[role=dialog]')!.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('fills the screen with the picture in this page, from the button on the picture or beside it', async () => {
    const { fixture, el } = viewer();
    await settle(fixture);

    for (const label of ['View the photo full screen', 'View full screen']) {
      button(el, label).click();
      await settle(fixture);
      const stage = el.querySelector('.stage')!;
      expect(stage.classList).toContain('is-full');
      expect(text(stage)).toContain('A patrol at Nui Dat · AWM');
      expect(document.activeElement).toBe(stage.querySelector('.stage__exit'));
      button(el, 'Exit full screen').click();
      await settle(fixture);
      expect(el.querySelector('.stage.is-full')).toBeNull();
    }
    expect(document.activeElement).toBe(button(el, 'View the photo full screen'));
  });

  it('asks the browser for true full screen of the picture where there is one', async () => {
    const request = vi.fn(function (this: HTMLElement) {
      return Promise.resolve();
    });
    (HTMLElement.prototype as unknown as { requestFullscreen: unknown }).requestFullscreen = request;
    try {
      const { fixture, el } = viewer();
      await settle(fixture);
      button(el, 'View full screen').click();
      await settle(fixture);

      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.contexts[0]).toBe(el.querySelector('.stage'));
    } finally {
      delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen;
    }
  });

  it('leaves full screen, not the dialog, on the first Escape, and keeps Tab on the exit button', async () => {
    const { fixture, el } = viewer();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    await settle(fixture);
    button(el, 'View full screen').click();
    await settle(fixture);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    el.querySelector('.stage__exit')!.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);

    el.querySelector('.stage')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(el.querySelector('.stage.is-full')).toBeNull();
    expect(closed).toBe(0);
  });

  it('comes out of full screen when the browser leaves it', async () => {
    const { fixture, el } = viewer();
    await settle(fixture);
    button(el, 'View full screen').click();
    await settle(fixture);

    document.dispatchEvent(new Event('fullscreenchange'));                  // nothing is full screen any more
    await settle(fixture);

    expect(el.querySelector('.stage.is-full')).toBeNull();
    expect(el.querySelector('[role=dialog]')).not.toBeNull();
  });

  it('starts out of full screen for another photo', async () => {
    const { fixture, el } = viewer();
    await settle(fixture);
    button(el, 'View full screen').click();
    await settle(fixture);

    fixture.componentRef.setInput('pictureId', 6);
    await settle(fixture);

    expect(el.querySelector('.stage.is-full')).toBeNull();
  });
});

describe('Battle Map community photos', () => {
  const withPictures = { community: { mediaOnMap: vi.fn(() => Promise.resolve(PICS)) } };

  it('draws the placed pictures, on top of the contacts, and offers a switch with their number', async () => {
    const r = await render(withPictures);

    expect(r.basemaps.map.sources.has(PHOTO_SOURCE)).toBe(true);
    const order = r.basemaps.map.addLayer.mock.calls.map((c) => c[0].id);
    expect(order.indexOf(PHOTO_POINTS)).toBeGreaterThan(order.indexOf('avw-contacts-points'));
    expect(text(r.el.querySelector('#tabpanel'))).toContain('Community photos (2)');
    expect(r.basemaps.map.addSource.mock.calls.find((c) => c[0] === PHOTO_SOURCE)).toBeDefined();
  });

  it('offers no switch when there are no pictures on the map', async () => {
    const r = await render({});

    expect(text(r.el.querySelector('#tabpanel'))).not.toContain('Community photos');
  });

  it('hides them with the switch', async () => {
    const r = await render(withPictures);
    const box = [...r.el.querySelectorAll<HTMLInputElement>('#tabpanel input[type=checkbox]')].find((i) => i.parentElement?.textContent?.includes('Community photos'))!;

    box.click();
    await settle(r.fixture);

    expect(r.basemaps.map.setLayoutProperty).toHaveBeenCalledWith(PHOTO_POINTS, 'visibility', 'none');
  });

  it('opens the viewer when a picture is clicked, over the incident panel, which stays open beneath', async () => {
    const r = await render({ ...withPictures, inputs: { incident: '2' } });
    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();

    r.basemaps.handlers.get(PHOTO_POINTS)!({ id: 5 });
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-viewer [role=dialog]')).not.toBeNull();
    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
    expect(r.basemaps.map.setFilter).toHaveBeenCalledWith(PHOTO_SELECTED, ['==', ['get', 'id'], 5]);
  });

  it('closes the viewer, and takes the ring off, when it is closed', async () => {
    const r = await render({ ...withPictures, community: { ...withPictures.community, mediaDetail: vi.fn(() => Promise.resolve(pic())) }, inputs: { picture: '5' } });
    await settle(r.fixture);

    r.el.querySelector<HTMLButtonElement>('app-picture-viewer [aria-label="Close the photo"]')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-viewer')).toBeNull();
    expect(r.basemaps.map.setFilter).toHaveBeenCalledWith(PHOTO_SELECTED, ['==', ['get', 'id'], -1]);
  });

  it('handles one click once, though both the dot and the thumbnail answer it', async () => {
    const r = await render(withPictures);
    r.basemaps.map.queryRenderedFeatures.mockReturnValue([{ properties: { id: 5 } }]);

    r.basemaps.handlers.get(PHOTO_POINTS)!({ id: 5 }, { lon: 107.17, lat: 10.56 });
    r.basemaps.handlers.get(PHOTO_IMAGES)!({ id: 5 }, { lon: 107.17, lat: 10.56 });
    await settle(r.fixture);

    expect(r.el.querySelectorAll('app-picture-viewer').length).toBe(1);
    expect(r.basemaps.map.setFilter.mock.calls.filter((c) => c[0] === PHOTO_SELECTED && c[1][2] === 5).length).toBe(1);
  });

  it('leaves the incident beneath a picture alone when the picture is clicked', async () => {
    const r = await render(withPictures);
    r.basemaps.map.queryRenderedFeatures.mockReturnValue([{ properties: { id: 5 } }]);

    r.basemaps.clickHandler!({ id: 9 }, { lon: 107.17, lat: 10.56 });
    await settle(r.fixture);

    expect(r.el.querySelector('app-incident-panel')).toBeNull();
  });

  it('springs apart pictures lying on top of each other, and opens the one then chosen', async () => {
    const r = await render(withPictures);
    r.basemaps.map.queryRenderedFeatures.mockReturnValue([{ properties: { id: 5 } }, { properties: { id: 6 } }]);

    r.basemaps.handlers.get(PHOTO_IMAGES)!({ id: 5 }, { lon: 107.17, lat: 10.56 });
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-viewer')).toBeNull();
    const spread = r.basemaps.map.dataFor(SPIDER_SOURCE).mock.calls.at(-1)![0] as FeatureCollection;
    expect(spread.features.map((f) => f.properties!['id'])).toEqual([5, 6]);
    expect(r.basemaps.map.setFilter).toHaveBeenCalledWith(PHOTO_POINTS, ['all', ['!', ['has', 'point_count']], ['!', ['in', ['get', 'id'], ['literal', [5, 6]]]]]);

    r.basemaps.handlers.get(SPIDER_IMAGES)!({ id: 6 });
    await settle(r.fixture);
    expect(r.el.querySelector('app-picture-viewer')).not.toBeNull();
    expect(r.basemaps.map.setFilter).toHaveBeenCalledWith(SPIDER_RING, ['==', ['get', 'id'], 6]);
  });

  it('closes up the spread pictures on a click on the empty map', async () => {
    const r = await render(withPictures);
    r.basemaps.map.queryRenderedFeatures.mockReturnValue([{ properties: { id: 5 } }, { properties: { id: 6 } }]);
    r.basemaps.handlers.get(PHOTO_IMAGES)!({ id: 5 }, { lon: 107.17, lat: 10.56 });
    await settle(r.fixture);

    r.basemaps.backgroundClick!();

    expect(r.basemaps.map.dataFor(SPIDER_SOURCE).mock.calls.at(-1)![0]).toEqual({ type: 'FeatureCollection', features: [] });
    expect(r.basemaps.map.setFilter).toHaveBeenLastCalledWith(PHOTO_COUNTS, ['has', 'point_count']);
  });

  it('opens the incident a picture belongs to from the viewer, closing the viewer', async () => {
    const community = {
      mediaOnMap: vi.fn(() => Promise.resolve(PICS)),
      mediaDetail: vi.fn(() => Promise.resolve(pic({ id: 6, contactId: 2 }))),
    };
    const r = await render({ community, inputs: { picture: '6' } });
    await settle(r.fixture);

    [...r.el.querySelectorAll<HTMLButtonElement>('app-picture-viewer button')].find((b) => b.textContent?.includes('Open the incident'))!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
    expect(r.el.querySelector('app-picture-viewer')).toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(10.55, 107.16, 13);
  });

  const clusterSource = (r: Awaited<ReturnType<typeof render>>, leaves: [number, number][]) => {
    const plain = r.basemaps.map.getSource;
    r.basemaps.map.getSource = ((id: string) =>
      id === PHOTO_SOURCE
        ? {
            getClusterExpansionZoom: () => Promise.resolve(12),
            getClusterLeaves: () => Promise.resolve(leaves.map(([lon, lat], i) => ({ geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { id: 5 + i } }))),
          }
        : plain(id)) as never;
    const easeTo = vi.fn();
    (r.basemaps.map as unknown as { easeTo: unknown }).easeTo = easeTo;
    return easeTo;
  };

  it('zooms into a group of pictures spread over an area when it is clicked', async () => {
    const r = await render(withPictures);
    const easeTo = clusterSource(r, [[107.17, 10.56], [107.2, 10.6]]);

    r.basemaps.handlers.get(PHOTO_CLUSTERS)!({ cluster_id: 3 }, { lon: 107.2, lat: 10.6 });
    await settle(r.fixture);

    expect(easeTo).toHaveBeenCalledWith({ center: [107.2, 10.6], zoom: 12.5, duration: 600 });
  });

  it('springs a group apart where it is, rather than zooming, when its pictures are all in one spot', async () => {
    const r = await render(withPictures);
    const easeTo = clusterSource(r, [[107.17, 10.56], [107.17, 10.56], [107.17001, 10.56]]);

    r.basemaps.handlers.get(PHOTO_CLUSTERS)!({ cluster_id: 3 }, { lon: 107.17, lat: 10.56 });
    await settle(r.fixture);

    expect(easeTo).not.toHaveBeenCalled();
    expect((r.basemaps.map.dataFor(SPIDER_SOURCE).mock.calls.at(-1)![0] as FeatureCollection).features).toHaveLength(3);
    expect(r.basemaps.map.setFilter).toHaveBeenCalledWith(PHOTO_CLUSTERS, ['all', ['has', 'point_count'], ['!=', ['get', 'cluster_id'], 3]]);
  });

  it('opens straight onto a picture from a link and frames it', async () => {
    const r = await render({ ...withPictures, inputs: { picture: '6' } });

    expect(r.el.querySelector('app-picture-viewer')).not.toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(10.6, 107.2, 11);
  });

  it.each(['abc', '-1', '0', '1.5'])('ignores a picture link that is not a picture id (%s)', async (bad) => {
    const r = await render({ ...withPictures, inputs: { picture: bad } });

    expect(r.el.querySelector('app-picture-viewer')).toBeNull();
    expect(r.basemaps.flyTo).not.toHaveBeenCalled();
  });

  it('opens a linked picture that is not on the map, going to its place if it has one', async () => {
    const mediaDetail = vi.fn(() => Promise.resolve(pic({ id: 40, status: 'Pending', lat: 10.4, lon: 107.1 })));
    const r = await render({ community: { ...withPictures.community, mediaDetail }, inputs: { picture: '40' } });

    expect(r.el.querySelector('app-picture-viewer')).not.toBeNull();
    expect(mediaDetail).toHaveBeenCalledWith(40);
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(10.4, 107.1, 15);
  });

  it('opens a linked picture over a linked incident', async () => {
    const r = await render({ ...withPictures, inputs: { incident: '2', picture: '5' } });

    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
    expect(r.el.querySelector('app-picture-viewer')).not.toBeNull();
  });

  it('still opens without them when they cannot be loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await render({ community: { mediaOnMap: vi.fn(() => Promise.reject(new Error('down'))) } });

    expect(r.el.querySelector('app-timeline')).not.toBeNull();
    expect(text(r.el.querySelector('#tabpanel'))).not.toContain('Community photos');
    warn.mockRestore();
  });
});
