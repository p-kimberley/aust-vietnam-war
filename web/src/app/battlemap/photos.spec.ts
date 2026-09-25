import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { PictureViewer, SLIDE_MS, formatBytes, formatType } from './picture-viewer';
import { SPIDER_IMAGES, SPIDER_RING, SPIDER_SOURCE } from './photo-spider';
import type { FeatureCollection } from 'geojson';
import { STACK_BADGES, STACK_COUNTS } from './photo-stacks';

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

    expect(map.addSource).toHaveBeenCalledTimes(2);                      // the pictures, and the badges on stacks of them
    expect(map.sources.get(PHOTO_SOURCE)).toMatchObject({ type: 'geojson', cluster: true });
    expect([...map.layers.keys()]).toEqual([PHOTO_CLUSTERS, PHOTO_COUNTS, PHOTO_POINTS, 'avw-photos-images', PHOTO_SELECTED, STACK_BADGES, STACK_COUNTS]);
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
    expect(text(none.el)).not.toContain('Go to incident');

    const attached = viewer({ mediaDetail: vi.fn(() => Promise.resolve(pic({ contactId: 2 }))) });
    const opened: number[] = [];
    attached.fixture.componentInstance.openIncident.subscribe((id) => opened.push(id));
    await settle(attached.fixture);
    button(attached.el, 'Go to incident').click();

    expect(opened).toEqual([2]);
    expect(button(attached.el, 'Locate on map')).toBeUndefined();              // the incident is the way to its place
  });

  it('offers to locate a picture on the map when it belongs to no incident, and not when it has no place', async () => {
    const placed = viewer();
    const located: unknown[] = [];
    placed.fixture.componentInstance.locate.subscribe((at) => located.push(at));
    await settle(placed.fixture);
    button(placed.el, 'Locate on map').click();
    expect(located).toEqual([{ lat: 10.56, lon: 107.17 }]);

    const nowhere = viewer({ mediaDetail: vi.fn(() => Promise.resolve(pic({ lat: null, lon: null }))) });
    await settle(nowhere.fixture);
    expect(button(nowhere.el, 'Locate on map')).toBeUndefined();
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

  it('stays full screen when it moves on to another photo', async () => {
    const { fixture, el } = viewer();
    await settle(fixture);
    button(el, 'View full screen').click();
    await settle(fixture);

    fixture.componentRef.setInput('pictureId', 6);
    await settle(fixture);

    expect(el.querySelector('.stage.is-full')).not.toBeNull();
  });
});

describe('PictureViewer: stepping through the photos of a place or an incident', () => {
  /** Pictures by id, as the API would give them. */
  const all: Record<number, IncidentMediaView> = {
    5: pic({ id: 5, contactId: 2, url: '/media/5.jpg', caption: 'Five' }),
    6: pic({ id: 6, contactId: 2, url: '/media/6.jpg', caption: 'Six' }),
    7: pic({ id: 7, contactId: null, url: '/media/7.jpg', caption: 'Seven' }),
    8: pic({ id: 8, contactId: null, url: '/media/8.jpg', caption: 'Eight', lat: null, lon: null }),
  };
  function stepping(start: number, over: Record<string, unknown> = {}) {
    TestBed.resetTestingModule();
    const community = fakeCommunity({
      mediaDetail: vi.fn((id: number) => Promise.resolve(all[id] ?? null)),
      media: vi.fn(() => Promise.resolve([all[5], all[6]])),                     // the incident's
      mediaInArea: vi.fn(() => Promise.resolve([all[7], all[5]])),              // placed at the same spot
      ...over,
    });
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...communityProviders(community, fakeAuth({}))] });
    const fixture = TestBed.createComponent(PictureViewer);
    fixture.componentRef.setInput('pictureId', start);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    // Stands in for the map, which opens whatever the viewer steps to.
    fixture.componentInstance.navigate.subscribe((id) => fixture.componentRef.setInput('pictureId', id));
    return { fixture, community, el: fixture.nativeElement as HTMLElement };
  }
  const arrow = (el: HTMLElement, which: 'Previous' | 'Next') => el.querySelector<HTMLButtonElement>(`[aria-label="${which} photo"]`)!;
  const count = (el: HTMLElement) => text(el.querySelector('.stage__count'));
  const title = (el: HTMLElement) => text(el.querySelector('h2'));

  it("steps through the incident's photos, then the others placed at the same spot, each once", async () => {
    const { fixture, el, community } = stepping(5);
    await settle(fixture);

    expect(community['media']).toHaveBeenCalledWith(2);
    const [minLat, minLon, maxLat, maxLon] = community['mediaInArea'].mock.calls[0] as number[];
    expect(maxLat - minLat).toBeCloseTo((2 * 30) / 111_320);                    // 30 m either side
    expect(minLon).toBeLessThan(107.17);
    expect(maxLon).toBeGreaterThan(107.17);
    expect(count(el)).toBe('1 of 3');
    expect(arrow(el, 'Previous').disabled).toBe(true);

    arrow(el, 'Next').click();
    await settle(fixture);
    expect([count(el), title(el)]).toEqual(['2 of 3', 'Six']);

    arrow(el, 'Next').click();
    await settle(fixture);
    expect([count(el), title(el)]).toEqual(['3 of 3', 'Seven']);
    expect(arrow(el, 'Next').disabled).toBe(true);
    expect(community['media']).toHaveBeenCalledTimes(1);                        // the set is kept while stepping
  });

  it('steps with the left and right arrow keys', async () => {
    const { fixture, el } = stepping(5);
    await settle(fixture);
    const key = (k: string) => el.querySelector('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

    key('ArrowRight');
    await settle(fixture);
    expect(title(el)).toBe('Six');
    key('ArrowLeft');
    await settle(fixture);
    expect(title(el)).toBe('Five');
    key('ArrowLeft');                                                           // already the first: nothing happens
    await settle(fixture);
    expect(title(el)).toBe('Five');
  });

  it('shows the next photo straight away, before its details have come', async () => {
    let answer: (v: IncidentMediaView) => void = () => undefined;
    const { fixture, el, community } = stepping(5);
    await settle(fixture);
    community['mediaDetail'].mockImplementation(() => new Promise<IncidentMediaView>((r) => (answer = r)));

    arrow(el, 'Next').click();
    fixture.detectChanges();                                                   // not settle: that would wait for the details
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    expect(el.querySelector('.stage__slot--current img')?.getAttribute('src')).toBe('/media/6.jpg');

    answer(all[6]);
    await settle(fixture);
    expect(title(el)).toBe('Six');
  });

  it('moves focus to the other arrow at the end of the set', async () => {
    const { fixture, el } = stepping(6);
    await settle(fixture);
    arrow(el, 'Next').focus();

    arrow(el, 'Next').click();
    await settle(fixture);

    expect(arrow(el, 'Next').disabled).toBe(true);
    expect(document.activeElement).toBe(arrow(el, 'Previous'));
  });

  it('shows no arrows for a photo on its own', async () => {
    const { fixture, el } = stepping(8, { mediaInArea: vi.fn(() => Promise.resolve([])) });
    await settle(fixture);

    expect(arrow(el, 'Next')).toBeNull();
    expect(el.querySelector('.stage__count')).toBeNull();
  });

  it('still opens the photo when the others cannot be found', async () => {
    const { fixture, el } = stepping(5, { media: vi.fn(() => Promise.reject(new Error('down'))), mediaInArea: vi.fn(() => Promise.reject(new Error('down'))) });
    await settle(fixture);

    expect(title(el)).toBe('Five');
    expect(arrow(el, 'Next')).toBeNull();
  });
});

describe('PictureViewer: sliding and swiping between photos', () => {
  const all: Record<number, IncidentMediaView> = {
    5: pic({ id: 5, url: '/media/5.jpg', caption: 'Five' }),
    6: pic({ id: 6, url: '/media/6.jpg', caption: 'Six' }),
    7: pic({ id: 7, url: '/media/7.jpg', caption: 'Seven' }),
  };
  /** A viewer on the middle photo of three, where motion is allowed, so the photos slide. */
  async function sliding(start = 6) {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    TestBed.resetTestingModule();
    const community = fakeCommunity({
      mediaDetail: vi.fn((id: number) => Promise.resolve(all[id] ?? null)),
      mediaInArea: vi.fn(() => Promise.resolve([all[5], all[6], all[7]])),
    });
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...communityProviders(community, fakeAuth({}))] });
    const fixture = TestBed.createComponent(PictureViewer);
    fixture.componentRef.setInput('pictureId', start);
    document.body.append(fixture.nativeElement);
    fixture.detectChanges();
    const opened: number[] = [];
    fixture.componentInstance.navigate.subscribe((id) => {
      opened.push(id);
      fixture.componentRef.setInput('pictureId', id);
    });
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const track = el.querySelector<HTMLElement>('.stage__track')!;
    Object.defineProperty(track, 'clientWidth', { value: 1000, configurable: true });
    const pointer = (type: string, x: number, y = 100) => {
      const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      track.dispatchEvent(e);
      fixture.detectChanges();
    };
    return { fixture, el, track, pointer, opened };
  }
  const slot = (el: HTMLElement, which: string) => el.querySelector(`.stage__slot--${which} img`)?.getAttribute('src');

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the photos either side in place beside the open one, ready to slide in', async () => {
    const { el } = await sliding();

    expect([slot(el, 'previous'), slot(el, 'current'), slot(el, 'next')]).toEqual(['/media/5.jpg', '/media/6.jpg', '/media/7.jpg']);
  });

  it('slides to the next photo, then opens it with the track back in place', async () => {
    const { fixture, el, track, opened } = await sliding();
    vi.useFakeTimers();

    el.querySelector<HTMLButtonElement>('[aria-label="Next photo"]')!.click();
    fixture.detectChanges();
    expect(track.classList).toContain('is-sliding');
    expect(track.style.transform).toBe('translateX(calc(-100% + 0px))');
    expect(opened).toEqual([]);

    vi.advanceTimersByTime(SLIDE_MS);
    fixture.detectChanges();
    expect(opened).toEqual([7]);
    expect(track.classList).not.toContain('is-sliding');
    expect(track.style.transform).toBe('translateX(calc(0% + 0px))');
  });

  it('slides the other way for the previous photo, and takes no second step while sliding', async () => {
    const { fixture, el, track, opened } = await sliding();
    vi.useFakeTimers();

    el.querySelector<HTMLButtonElement>('[aria-label="Previous photo"]')!.click();
    el.querySelector<HTMLButtonElement>('[aria-label="Previous photo"]')!.click();
    fixture.detectChanges();
    expect(track.style.transform).toBe('translateX(calc(100% + 0px))');

    vi.advanceTimersByTime(SLIDE_MS * 2);
    expect(opened).toEqual([5]);
  });

  it('follows a finger sideways, and slides on to the next photo when let go far enough along', async () => {
    const { fixture, track, pointer, opened } = await sliding();
    vi.useFakeTimers();

    pointer('pointerdown', 600);
    pointer('pointermove', 590);
    pointer('pointermove', 450);
    expect(track.style.transform).toBe('translateX(calc(0% + -150px))');
    expect(track.classList).not.toContain('is-sliding');

    vi.advanceTimersByTime(200);                                               // a slow drag, not a flick
    pointer('pointermove', 350);
    pointer('pointerup', 350);
    expect(track.style.transform).toBe('translateX(calc(-100% + 0px))');
    vi.advanceTimersByTime(SLIDE_MS);
    fixture.detectChanges();
    expect(opened).toEqual([7]);
  });

  it('springs back when let go too soon', async () => {
    const { track, pointer, opened } = await sliding();
    vi.useFakeTimers();

    pointer('pointerdown', 600);
    pointer('pointermove', 590);
    vi.advanceTimersByTime(200);
    pointer('pointermove', 520);
    pointer('pointerup', 520);

    expect(track.style.transform).toBe('translateX(calc(0% + 0px))');
    expect(track.classList).toContain('is-sliding');
    vi.advanceTimersByTime(SLIDE_MS);
    expect(opened).toEqual([]);
  });

  it('takes a quick flick as a swipe, however short', async () => {
    const { pointer, opened } = await sliding();
    vi.useFakeTimers();

    pointer('pointerdown', 400);
    pointer('pointermove', 410);
    vi.advanceTimersByTime(20);
    pointer('pointermove', 480);                                                // 70 px in 20 ms
    pointer('pointerup', 480);
    vi.advanceTimersByTime(SLIDE_MS);

    expect(opened).toEqual([5]);
  });

  it('resists a drag past the last photo, and goes nowhere', async () => {
    const { track, pointer, opened } = await sliding(7);
    vi.useFakeTimers();

    pointer('pointerdown', 600);
    pointer('pointermove', 590);
    pointer('pointermove', 300);
    expect(track.style.transform).toBe('translateX(calc(0% + -90px))');       // 300 px of finger, 30% of it

    pointer('pointerup', 300);
    vi.advanceTimersByTime(SLIDE_MS);
    expect(opened).toEqual([]);
  });

  it('leaves an up-and-down move to the page', async () => {
    const { track, pointer } = await sliding();

    pointer('pointerdown', 600, 100);
    pointer('pointermove', 603, 140);
    pointer('pointermove', 500, 200);

    expect(track.style.transform).toBe('translateX(calc(0% + 0px))');
  });

  it('does not close when a drag is let go off the photo, over the dim round it', async () => {
    const { fixture, el, pointer } = await sliding();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);

    pointer('pointerdown', 600);
    pointer('pointermove', 590);
    pointer('pointermove', 560);
    pointer('pointerup', 560);
    el.querySelector<HTMLElement>('.viewer')!.click();
    expect(closed).toBe(0);

    await new Promise((r) => setTimeout(r));
    el.querySelector<HTMLElement>('.viewer')!.click();
    expect(closed).toBe(1);
  });

  it('changes photo at once, without sliding, for anyone who asked for less motion', async () => {
    const { fixture, el, track, opened } = await sliding();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));

    el.querySelector<HTMLButtonElement>('[aria-label="Next photo"]')!.click();
    fixture.detectChanges();

    expect(opened).toEqual([7]);
    expect(track.classList).not.toContain('is-sliding');
  });
});

describe('Battle Map: stepping through photos in the viewer', () => {
  it('rings each photo on the map, and puts it in the link, as the viewer steps to it', async () => {
    const pics = [pic({ id: 5 }), pic({ id: 6 })];
    const r = await render({
      community: {
        mediaOnMap: vi.fn(() => Promise.resolve(pics)),
        mediaDetail: vi.fn((id: number) => Promise.resolve(pics.find((p) => p.id === id) ?? null)),
        mediaInArea: vi.fn(() => Promise.resolve(pics)),
      },
      inputs: { picture: '5' },
    });
    await settle(r.fixture);

    r.el.querySelector<HTMLButtonElement>('[aria-label="Next photo"]')!.click();
    await settle(r.fixture);

    expect(r.basemaps.map.setFilter).toHaveBeenLastCalledWith(SPIDER_RING, ['==', ['get', 'id'], 6]);
    expect(r.basemaps.map.setFilter).toHaveBeenCalledWith(PHOTO_SELECTED, ['==', ['get', 'id'], 6]);
  });
});

describe('Battle Map community photos', () => {
  /** What is drawn under the pointer: these pictures, and no stack badge. */
  const under = (r: Awaited<ReturnType<typeof render>>, features: { properties: Record<string, unknown> }[]) =>
    r.basemaps.map.queryRenderedFeatures.mockImplementation((_p?: unknown, o?: unknown) =>
      (o as { layers: string[] }).layers.every((l) => l === STACK_BADGES) ? [] : features,
    );

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
    under(r, [{ properties: { id: 5 } }]);

    r.basemaps.handlers.get(PHOTO_POINTS)!({ id: 5 }, { lon: 107.17, lat: 10.56 });
    r.basemaps.handlers.get(PHOTO_IMAGES)!({ id: 5 }, { lon: 107.17, lat: 10.56 });
    await settle(r.fixture);

    expect(r.el.querySelectorAll('app-picture-viewer').length).toBe(1);
    expect(r.basemaps.map.setFilter.mock.calls.filter((c) => c[0] === PHOTO_SELECTED && c[1][2] === 5).length).toBe(1);
  });

  it('leaves the incident beneath a picture alone when the picture is clicked', async () => {
    const r = await render(withPictures);
    under(r, [{ properties: { id: 5 } }]);

    r.basemaps.clickHandler!({ id: 9 }, { lon: 107.17, lat: 10.56 });
    await settle(r.fixture);

    expect(r.el.querySelector('app-incident-panel')).toBeNull();
  });

  it('springs apart pictures lying on top of each other, and opens the one then chosen', async () => {
    const r = await render(withPictures);
    under(r, [{ properties: { id: 5 } }, { properties: { id: 6 } }]);

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
    under(r, [{ properties: { id: 5 } }, { properties: { id: 6 } }]);
    r.basemaps.handlers.get(PHOTO_IMAGES)!({ id: 5 }, { lon: 107.17, lat: 10.56 });
    await settle(r.fixture);

    r.basemaps.backgroundClick!();

    expect(r.basemaps.map.dataFor(SPIDER_SOURCE).mock.calls.at(-1)![0]).toEqual({ type: 'FeatureCollection', features: [] });
    expect(r.basemaps.map.setFilter).toHaveBeenCalledWith(PHOTO_COUNTS, ['has', 'point_count']);
    expect(r.basemaps.map.setFilter).toHaveBeenLastCalledWith(STACK_COUNTS, ['has', 'count']);
  });

  it('closes the viewer and takes the map to a picture from "Locate on map"', async () => {
    const r = await render({ ...withPictures, community: { ...withPictures.community, mediaDetail: vi.fn(() => Promise.resolve(pic())) }, inputs: { picture: '5', at: '10,107,9' } });
    await settle(r.fixture);

    [...r.el.querySelectorAll<HTMLButtonElement>('app-picture-viewer button')].find((b) => b.textContent?.includes('Locate on map'))!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-viewer')).toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(10.56, 107.17, 15);
  });

  it('opens the incident a picture belongs to from the viewer, closing the viewer', async () => {
    const community = {
      mediaOnMap: vi.fn(() => Promise.resolve(PICS)),
      mediaDetail: vi.fn(() => Promise.resolve(pic({ id: 6, contactId: 2 }))),
    };
    const r = await render({ community, inputs: { picture: '6' } });
    await settle(r.fixture);

    [...r.el.querySelectorAll<HTMLButtonElement>('app-picture-viewer button')].find((b) => b.textContent?.includes('Go to incident'))!.click();
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
