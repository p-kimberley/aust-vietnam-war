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
import { PicturePanel, formatBytes, formatType } from './picture-panel';

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
    };
  }

  it('adds a grouping source, group discs and counts, single markers and a selection ring, once', () => {
    const map = fake();

    addPhotoLayers(map as never, PICS, { visible: true, selectedId: null });
    addPhotoLayers(map as never, PICS, { visible: true, selectedId: null });

    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.sources.get(PHOTO_SOURCE)).toMatchObject({ type: 'geojson', cluster: true });
    expect([...map.layers.keys()]).toEqual([PHOTO_CLUSTERS, PHOTO_COUNTS, PHOTO_POINTS, PHOTO_SELECTED]);
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

describe('PicturePanel', () => {
  function panel(over: Record<string, unknown> = {}, user: Parameters<typeof fakeAuth>[0] = {}) {
    TestBed.resetTestingModule();
    const community = fakeCommunity({ mediaDetail: vi.fn(() => Promise.resolve(pic())), ...over });
    const auth = fakeAuth(user);
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...communityProviders(community, auth)] });
    const fixture = TestBed.createComponent(PicturePanel);
    fixture.componentRef.setInput('pictureId', 5);
    fixture.detectChanges();
    return { fixture, community, auth, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the picture with its caption, credit, date and likes', async () => {
    const { fixture, el } = panel();
    await settle(fixture);

    expect(el.querySelector('img')?.getAttribute('src')).toBe('/media/aa/full-480.jpg');
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('A patrol at Nui Dat');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/media/aa/full.jpg');
    expect(text(el)).toContain('A patrol at Nui Dat');
    expect(text(el)).toContain('AWM');
    expect(text(el)).toContain('18 Aug 1966');
    expect(text(el)).toContain('Likes3');
  });

  it('leaves out what it does not have, and describes a picture with no caption', async () => {
    const { fixture, el } = panel({ mediaDetail: vi.fn(() => Promise.resolve(pic({ caption: null, credit: null, dateTaken: null }))) });
    await settle(fixture);

    expect(text(el)).not.toContain('Credit');
    expect(text(el)).not.toContain('Taken');
    expect(el.querySelector('img')?.getAttribute('alt')).toBe('A photo placed on the map');
  });

  it('asks a visitor to sign in, and offers a like to a member', async () => {
    const visitor = panel();
    await settle(visitor.fixture);
    expect(text(visitor.el)).toContain('Sign in to like a photo');
    expect(visitor.el.querySelector('[aria-pressed]')).toBeNull();
    [...visitor.el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Sign in')!.click();
    expect(visitor.auth.login).toHaveBeenCalled();

    const member = panel({}, { authenticated: true, roles: ['member'] });
    await settle(member.fixture);
    expect(text(member.el)).toContain('Like this photo');
  });

  it('likes and unlikes, showing the new count', async () => {
    const toggleLike = vi
      .fn()
      .mockResolvedValueOnce({ likes: 4, liked: true })
      .mockResolvedValueOnce({ likes: 3, liked: false });
    const { fixture, el } = panel({ toggleLike }, { authenticated: true, roles: ['member'] });
    await settle(fixture);
    const button = () => el.querySelector<HTMLButtonElement>('[aria-pressed]')!;

    button().click();
    await settle(fixture);
    expect(toggleLike).toHaveBeenCalledWith(5);
    expect(text(el)).toContain('Likes4');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(text(button())).toContain('Liked');

    button().click();
    await settle(fixture);
    expect(text(el)).toContain('Likes3');
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('says so when a like cannot be saved', async () => {
    const { fixture, el } = panel({ toggleLike: vi.fn(() => Promise.reject(new Error('down'))) }, { authenticated: true, roles: ['member'] });
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('[aria-pressed]')!.click();
    await settle(fixture);

    expect(text(el.querySelector('[role=alert]'))).toContain('could not be saved');
    expect(text(el)).toContain('Likes3');
  });

  it('offers the incident only when the picture belongs to one', async () => {
    const none = panel();
    await settle(none.fixture);
    expect(text(none.el)).not.toContain('Open the incident');

    const attached = panel({ mediaDetail: vi.fn(() => Promise.resolve(pic({ contactId: 2 }))) });
    const opened: number[] = [];
    attached.fixture.componentInstance.openIncident.subscribe((id) => opened.push(id));
    await settle(attached.fixture);
    [...attached.el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Open the incident'))!.click();

    expect(opened).toEqual([2]);
  });

  it('says so when there is no such picture, and offers a retry when loading fails', async () => {
    const missing = panel({ mediaDetail: vi.fn(() => Promise.resolve(null)) });
    await settle(missing.fixture);
    expect(text(missing.el)).toContain('not found');

    const broken = panel({ mediaDetail: vi.fn(() => Promise.reject(new Error('down'))) });
    await settle(broken.fixture);
    expect(text(broken.el.querySelector('[role=alert]'))).toContain('could not be loaded');
  });

  it('tells the parent when it is closed', async () => {
    const { fixture, el } = panel();
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('.pic__close')!.click();

    expect(closed).toBe(1);
  });
});

describe('PicturePanel upload details and full screen', () => {
  function open(over: Partial<IncidentMediaView> = {}) {
    TestBed.resetTestingModule();
    const community = fakeCommunity({ mediaDetail: vi.fn(() => Promise.resolve(pic(over))) });
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...communityProviders(community, fakeAuth({}))] });
    const fixture = TestBed.createComponent(PicturePanel);
    fixture.componentRef.setInput('pictureId', 5);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  const button = (el: HTMLElement, label: string) => [...el.querySelectorAll('button')].find((b) => text(b) === label)!;

  it('shows what was recorded when it was uploaded: who added it, when, where, and the size and kind of file', async () => {
    const { fixture, el } = open({ contactId: 2 });
    await settle(fixture);

    expect(text(el)).toContain('Added by Alex Member');
    expect(text(el)).toContain('Added2 Sep 2018');
    expect(text(el)).toContain('Location10.56000, 107.17000');
    expect(text(el)).toContain('Image800 × 600 px · 179.2 KB · JPG');
    expect(text(el)).toContain('Incident2');
  });

  it('leaves out who added it when that is not known, and the place and incident when it has none', async () => {
    const { fixture, el } = open({ addedBy: null, lat: null, lon: null, contactId: null });
    await settle(fixture);

    expect(text(el)).not.toContain('Added by');
    expect(text(el)).not.toContain('Location');
    expect(text(el)).not.toContain('Incident2');
    expect(text(el)).toContain('Added2 Sep 2018');
  });

  it('writes a file size and a kind of file for a person', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
    expect(formatType('image/jpeg')).toBe('JPG');
    expect(formatType('image/png')).toBe('PNG');
    expect(formatType('image/webp')).toBe('WEBP');
  });

  it('has a button to view the photo full screen, and the photo is one too, keeping the link to open it in a tab', async () => {
    const { fixture, el } = open();
    await settle(fixture);

    expect(button(el, 'View fullscreen')).toBeDefined();
    expect(el.querySelector('.pic__zoom')!.getAttribute('aria-label')).toBe('View the photo full screen');
    const tab = [...el.querySelectorAll('a')].find((a) => text(a) === 'Open in a new tab')!;
    expect(tab.getAttribute('href')).toBe('/media/aa/full.jpg');
    expect(tab.getAttribute('target')).toBe('_blank');
    expect(el.querySelector('.fs')).toBeNull();
  });

  it('opens the full-size photo over the window, with its caption and credit, and takes focus', async () => {
    const { fixture, el } = open();
    await settle(fixture);

    button(el, 'View fullscreen').click();
    await settle(fixture);

    const fs = el.querySelector('.fs')!;
    expect(fs.getAttribute('role')).toBe('dialog');
    expect(fs.getAttribute('aria-modal')).toBe('true');
    expect(fs.querySelector('img')!.getAttribute('src')).toBe('/media/aa/full.jpg');
    expect(text(fs)).toContain('A patrol at Nui Dat');
    expect(text(fs)).toContain('AWM');
    expect(document.activeElement).toBe(fs.querySelector('.fs__close'));
  });

  it('asks the browser for true full screen where there is one, and is still a full-window view where there is not', async () => {
    const request = vi.fn(() => Promise.resolve());
    (HTMLElement.prototype as unknown as { requestFullscreen: unknown }).requestFullscreen = request;
    try {
      const { fixture, el } = open();
      await settle(fixture);
      button(el, 'View fullscreen').click();
      await settle(fixture);

      expect(request).toHaveBeenCalledTimes(1);
      expect(el.querySelector('.fs')).not.toBeNull();
    } finally {
      delete (HTMLElement.prototype as unknown as { requestFullscreen?: unknown }).requestFullscreen;
    }
  });

  it('opens from a click on the photo itself', async () => {
    const { fixture, el } = open();
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('.pic__zoom')!.click();
    await settle(fixture);

    expect(el.querySelector('.fs')).not.toBeNull();
  });

  it('closes with the close button, Escape or a click beside the photo, and gives focus back', async () => {
    const { fixture, el } = open();
    await settle(fixture);
    const reopen = async () => {
      button(el, 'View fullscreen').click();
      await settle(fixture);
    };

    await reopen();
    el.querySelector<HTMLButtonElement>('.fs__close')!.click();
    await settle(fixture);
    expect(el.querySelector('.fs')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('.pic__zoom'));

    await reopen();
    el.querySelector('.fs')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(fixture);
    expect(el.querySelector('.fs')).toBeNull();

    await reopen();
    el.querySelector<HTMLElement>('.fs')!.click();
    await settle(fixture);
    expect(el.querySelector('.fs')).toBeNull();
  });

  it('stays open when the photo or its caption is clicked, and keeps Tab on the close button', async () => {
    const { fixture, el } = open();
    await settle(fixture);
    button(el, 'View fullscreen').click();
    await settle(fixture);

    el.querySelector<HTMLElement>('.fs__img')!.click();
    el.querySelector<HTMLElement>('.fs__caption')!.click();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    el.querySelector('.fs')!.dispatchEvent(tab);
    await settle(fixture);

    expect(el.querySelector('.fs')).not.toBeNull();
    expect(tab.defaultPrevented).toBe(true);
  });

  it('closes when the browser leaves full screen, as it does on Escape', async () => {
    const { fixture, el } = open();
    await settle(fixture);
    button(el, 'View fullscreen').click();
    await settle(fixture);

    document.dispatchEvent(new Event('fullscreenchange'));                  // nothing is full screen any more
    await settle(fixture);

    expect(el.querySelector('.fs')).toBeNull();
  });

  it('starts shut for another photo', async () => {
    const { fixture, el } = open();
    await settle(fixture);
    button(el, 'View fullscreen').click();
    await settle(fixture);
    expect(el.querySelector('.fs')).not.toBeNull();

    fixture.componentRef.setInput('pictureId', 6);
    await settle(fixture);

    expect(el.querySelector('.fs')).toBeNull();
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

  it('opens the picture panel when a picture is clicked, and closes the incident panel', async () => {
    const r = await render({ ...withPictures, inputs: { incident: '2' } });
    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();

    r.basemaps.handlers.get(PHOTO_POINTS)!({ id: 5 });
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-panel')).not.toBeNull();
    expect(r.el.querySelector('app-incident-panel')).toBeNull();
    expect(r.basemaps.map.setFilter).toHaveBeenCalledWith(PHOTO_SELECTED, ['==', ['get', 'id'], 5]);
  });

  it('closes the picture panel when a contact is clicked, and rings nothing', async () => {
    const r = await render({ ...withPictures, inputs: { picture: '5' } });
    expect(r.el.querySelector('app-picture-panel')).not.toBeNull();

    r.basemaps.clickHandler!({ id: 9 });
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-panel')).toBeNull();
    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
    expect(r.basemaps.map.setFilter).toHaveBeenCalledWith(PHOTO_SELECTED, ['==', ['get', 'id'], -1]);
  });

  it('opens the incident a picture belongs to, from the panel', async () => {
    const community = {
      mediaOnMap: vi.fn(() => Promise.resolve(PICS)),
      mediaDetail: vi.fn(() => Promise.resolve(pic({ id: 6, contactId: 2 }))),
    };
    const r = await render({ community, inputs: { picture: '6' } });
    await settle(r.fixture);

    [...r.el.querySelectorAll<HTMLButtonElement>('app-picture-panel button')].find((b) => b.textContent?.includes('Open the incident'))!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
    expect(r.el.querySelector('app-picture-panel')).toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(10.55, 107.16, 13);
  });

  it('zooms into a group of pictures when it is clicked', async () => {
    const r = await render(withPictures);
    r.basemaps.map.getSource = ((id: string) => (id === PHOTO_SOURCE ? { getClusterExpansionZoom: () => Promise.resolve(12) } : undefined)) as never;
    const easeTo = vi.fn();
    (r.basemaps.map as unknown as { easeTo: unknown }).easeTo = easeTo;

    r.basemaps.handlers.get(PHOTO_CLUSTERS)!({ cluster_id: 3 }, { lon: 107.2, lat: 10.6 });
    await settle(r.fixture);

    expect(easeTo).toHaveBeenCalledWith({ center: [107.2, 10.6], zoom: 12.5, duration: 600 });
  });

  it('opens straight onto a picture from a link and frames it', async () => {
    const r = await render({ ...withPictures, inputs: { picture: '6' } });

    expect(r.el.querySelector('app-picture-panel')).not.toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(10.6, 107.2, 11);
  });

  it.each(['abc', '99999', '-1', '7'])('ignores a picture link that is not a picture on the map (%s)', async (bad) => {
    const r = await render({ ...withPictures, inputs: { picture: bad } });

    expect(r.el.querySelector('app-picture-panel')).toBeNull();
    expect(r.basemaps.flyTo).not.toHaveBeenCalled();
  });

  it('does not open a picture when the link also names an incident', async () => {
    const r = await render({ ...withPictures, inputs: { incident: '2', picture: '5' } });

    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
    expect(r.el.querySelector('app-picture-panel')).toBeNull();
  });

  it('still opens without them when they cannot be loaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = await render({ community: { mediaOnMap: vi.fn(() => Promise.reject(new Error('down'))) } });

    expect(r.el.querySelector('app-timeline')).not.toBeNull();
    expect(text(r.el.querySelector('#tabpanel'))).not.toContain('Community photos');
    warn.mockRestore();
  });
});
