import { provideZonelessChangeDetection, signal } from '@angular/core';
import type { Role } from '../core/auth.service';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { render, settle } from './battlemap-testing';
import { IncidentMediaView, PictureHit } from './community/community';
import { communityProviders, fakeAuth, fakeCommunity } from './community/community-testing';
import { PHOTO_SOURCE } from './photo-layers';
import { Place, PicturePlacementService } from './picture-placement.service';
import { PICTURES_DELAY_MS, PICTURES_PAGE_SIZE, PicturesPanel } from './pictures-panel';

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

const hit = (id: number, over: Partial<PictureHit> = {}): PictureHit => ({
  id, contactId: null, thumbUrl: `/media/${id}-480.jpg`, caption: `Picture ${id}`, credit: 'AWM', lat: 10.5, lon: 107.2, ...over,
});

const added = (over: Partial<IncidentMediaView> = {}): IncidentMediaView => ({
  id: 90, mediaId: 9, contactId: null, url: '/media/new.jpg', thumbUrl: '/media/new-480.jpg', width: 800, height: 600, caption: 'Nui Dat', credit: null,
  dateTaken: null, lat: 10.49, lon: 107.2, status: 'Pending', likes: 0, likedByMe: false, mine: true, canRemove: true, byteSize: 1000,
  contentType: 'image/jpeg', addedUtc: '2026-09-25T00:00:00Z', addedBy: null, ...over,
});

/** A placement service that records what it is asked, with no map behind it. */
function fakePlacement() {
  return {
    place: signal<Place | null>(null),
    dropAt: vi.fn(() => true),
    placeAtCentre: vi.fn(function (this: { place: ReturnType<typeof signal<Place | null>> }) {
      this.place.set({ lat: 10.55, lon: 107.17 });
    }),
    setPreview: vi.fn(),
    clear: vi.fn(function (this: { place: ReturnType<typeof signal<Place | null>> }) {
      this.place.set(null);
    }),
  };
}

function mount(over: Record<string, unknown> = {}, user: Parameters<typeof fakeAuth>[0] = {}) {
  TestBed.resetTestingModule();
  const community = fakeCommunity(over);
  const placement = fakePlacement();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), ...communityProviders(community, fakeAuth(user)), { provide: PicturePlacementService, useValue: placement }],
  });
  const fixture = TestBed.createComponent(PicturesPanel);
  fixture.detectChanges();
  return { fixture, community, placement, el: fixture.nativeElement as HTMLElement };
}

const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === label || b.getAttribute('aria-label') === label)!;

describe('PicturesPanel: finding pictures', () => {
  it('starts with the newest pictures, and says how many there are', async () => {
    const searchPictures = vi.fn(() => Promise.resolve({ items: [hit(1), hit(2, { caption: null })], total: 30, page: 1, pageSize: 24 }));
    const { fixture, el } = mount({ searchPictures });
    await settle(fixture);

    expect(searchPictures).toHaveBeenCalledWith('', 1, PICTURES_PAGE_SIZE, null);
    expect([...el.querySelectorAll('.hit__caption')].map(text)).toEqual(['Picture 1', 'Untitled']);
    expect(el.querySelector('.hit img')?.getAttribute('src')).toBe('/media/1-480.jpg');
    expect(text(el.querySelector('.count'))).toBe('Showing 2 of 30 images');
  });

  it('searches once typing pauses, and only the latest search counts', async () => {
    vi.useFakeTimers();
    try {
      const searchPictures = vi.fn((q: string) => Promise.resolve({ items: q ? [hit(7)] : [], total: q ? 1 : 0, page: 1, pageSize: 24 }));
      const { fixture, el } = mount({ searchPictures });
      const input = el.querySelector<HTMLInputElement>('input[type=search]')!;

      input.value = 'bun';
      input.dispatchEvent(new Event('input'));
      input.value = 'bunker';
      input.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(PICTURES_DELAY_MS);
      fixture.detectChanges();

      expect(searchPictures.mock.calls.map((c) => c[0])).toEqual(['', 'bunker']);
      expect(text(el.querySelector('.count'))).toBe('1 image');
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds the next page with Show more', async () => {
    const searchPictures = vi
      .fn()
      .mockResolvedValueOnce({ items: [hit(1)], total: 2, page: 1, pageSize: 1 })
      .mockResolvedValueOnce({ items: [hit(2)], total: 2, page: 2, pageSize: 1 });
    const { fixture, el } = mount({ searchPictures });
    await settle(fixture);

    button(el, 'Show more').click();
    await settle(fixture);

    expect(searchPictures).toHaveBeenLastCalledWith('', 2, PICTURES_PAGE_SIZE, null);
    expect(el.querySelectorAll('.hit')).toHaveLength(2);
    expect(button(el, 'Show more')).toBeUndefined();
  });

  it('says when nothing matches, and when the search fails', async () => {
    const empty = mount();
    await settle(empty.fixture);
    expect(text(empty.el.querySelector('.count'))).toBe('No images have been added yet.');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = mount({ searchPictures: vi.fn(() => Promise.reject(new Error('down'))) });
    await settle(broken.fixture);
    expect(text(broken.el.querySelector('[role=alert]'))).toContain('could not be searched');
    warn.mockRestore();
  });

  it('opens a picture chosen from the list, with its place for the map', async () => {
    const { fixture, el } = mount({ searchPictures: vi.fn(() => Promise.resolve({ items: [hit(3)], total: 1, page: 1, pageSize: 24 })) });
    const chosen: unknown[] = [];
    fixture.componentInstance.openPicture.subscribe((p) => chosen.push(p));
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('.hit')!.click();

    expect(chosen).toEqual([{ id: 3, lat: 10.5, lon: 107.2 }]);
  });
});

describe('PicturesPanel: sort order', () => {
  const page = { items: [hit(1, { dateTaken: '1966-08-18' })], total: 1, page: 1, pageSize: 24 };
  const options = (el: HTMLElement) => [...el.querySelectorAll<HTMLOptionElement>('.sort option')].map((o) => [o.value, text(o)]);
  const chosen = (el: HTMLElement) => el.querySelector<HTMLSelectElement>('.sort select')!.value;

  it('lists newest first to begin with, offering the other orders, and shows when each was taken', async () => {
    const { fixture, el } = mount({ searchPictures: vi.fn(() => Promise.resolve(page)) });
    await settle(fixture);

    expect(chosen(el)).toBe('newest');
    expect(options(el)).toEqual([
      ['newest', 'Newest added'],
      ['oldest', 'Oldest added'],
      ['taken-newest', 'Date taken, latest'],
      ['taken-oldest', 'Date taken, earliest'],
    ]);
    expect(text(el.querySelector('.hit__credit'))).toBe('AWM · 18 Aug 1966');
  });

  it('lists again in the order chosen, from the first page', async () => {
    const searchPictures = vi.fn(() => Promise.resolve(page));
    const { fixture, el } = mount({ searchPictures });
    await settle(fixture);

    const select = el.querySelector<HTMLSelectElement>('.sort select')!;
    select.value = 'taken-oldest';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(searchPictures).toHaveBeenLastCalledWith('', 1, PICTURES_PAGE_SIZE, 'taken-oldest');
    expect(chosen(el)).toBe('taken-oldest');
  });

  it('offers best match, first, while searching, and goes back to newest when the search is cleared', async () => {
    vi.useFakeTimers();
    try {
      const searchPictures = vi.fn(() => Promise.resolve(page));
      const { fixture, el } = mount({ searchPictures });
      const input = el.querySelector<HTMLInputElement>('input[type=search]')!;
      const type = async (value: string) => {
        input.value = value;
        input.dispatchEvent(new Event('input'));
        await vi.advanceTimersByTimeAsync(PICTURES_DELAY_MS);
        fixture.detectChanges();
      };

      await type('patrol');
      expect(options(el)[0]).toEqual(['relevance', 'Best match']);
      expect(chosen(el)).toBe('relevance');

      const select = el.querySelector<HTMLSelectElement>('.sort select')!;
      select.value = 'relevance';
      select.dispatchEvent(new Event('change'));
      await type('');
      expect(searchPictures).toHaveBeenLastCalledWith('', 1, PICTURES_PAGE_SIZE, null);
      expect(chosen(el)).toBe('newest');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PicturesPanel: switching between the list and the form', () => {
  it('lists the images with a button to add one, and no Find button', async () => {
    const { fixture, el } = mount();
    await settle(fixture);

    expect(text(el.querySelector('h2'))).toBe('Images');
    expect(button(el, 'Find')).toBeUndefined();
    expect(el.querySelector('input[type=search]')).not.toBeNull();
    expect(button(el, 'Upload')).toBeDefined();
  });

  it('swaps the list for the form, and back again', async () => {
    const { fixture, el } = mount({}, { authenticated: true, roles: ['member'] });
    await settle(fixture);

    button(el, 'Upload').click();
    fixture.detectChanges();
    expect(el.querySelector('form')).not.toBeNull();
    expect(el.querySelector('input[type=search]')).toBeNull();

    button(el, 'Back to the images').click();
    fixture.detectChanges();
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('input[type=search]')).not.toBeNull();
  });
});

describe('PicturesPanel: adding a picture', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'nui-dat.jpg', { type: 'image/jpeg' });
  async function adding(over: Record<string, unknown> = {}, roles: Role[] = ['member']) {
    const r = mount(over, { authenticated: true, roles });
    await settle(r.fixture);
    button(r.el, 'Upload').click();
    await settle(r.fixture);
    return r;
  }
  function chooseFile(el: HTMLElement) {
    const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  }
  const typeInto = (el: HTMLElement, label: string, value: string) => {
    const input = [...el.querySelectorAll('label')].find((l) => text(l)?.startsWith(label))!.querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  it('asks a visitor to sign in first', async () => {
    const { fixture, el } = mount();
    await settle(fixture);
    button(el, 'Upload').click();
    await settle(fixture);

    expect(text(el)).toContain('Sign in to add an image');
    expect(el.querySelector('form')).toBeNull();
  });

  it('cannot be sent until there is a picture and a place for it', async () => {
    const { fixture, el, placement } = await adding();
    const send = () => button(el, 'Send for approval');
    expect(send().disabled).toBe(true);

    chooseFile(el);
    fixture.detectChanges();
    expect(send().disabled).toBe(true);
    expect(text(el)).toContain('Drag the pin onto the map');

    placement.place.set({ lat: 10.49, lon: 107.2 });
    fixture.detectChanges();
    expect(send().disabled).toBe(false);
    expect(text(el)).toContain('Placed at 10.49000, 107.20000');
  });

  it('puts the pin in the middle of the map when it is pressed rather than dragged', async () => {
    const { fixture, el, placement } = await adding();

    button(el, 'Put the pin in the middle of the map').click();
    fixture.detectChanges();

    expect(placement.placeAtCentre).toHaveBeenCalled();
    expect(text(el)).toContain('Placed at 10.55000, 107.17000');
  });

  it('drops the pin where it is dragged to, following the pointer on the way', async () => {
    const { fixture, el, placement } = await adding();
    const pin = el.querySelector<HTMLButtonElement>('.pin')!;
    const pointer = (type: string, x: number, y: number) => {
      const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      pin.dispatchEvent(e);
    };

    pointer('pointerdown', 10, 10);
    pointer('pointermove', 300, 200);
    fixture.detectChanges();
    const ghost = el.querySelector<HTMLElement>('.ghost')!;
    expect(ghost.style.left).toBe('300px');
    expect(ghost.style.top).toBe('200px');

    pointer('pointerup', 320, 240);
    pin.click();                                                              // the click that ends a drag is not a press
    fixture.detectChanges();

    expect(placement.dropAt).toHaveBeenCalledWith(320, 240);
    expect(placement.placeAtCentre).not.toHaveBeenCalled();
    expect(el.querySelector('.ghost')).toBeNull();
  });

  it('shows the picture chosen, on the pin as well', async () => {
    const createObjectURL = vi.fn(() => 'blob:picture');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const { fixture, el, placement } = await adding();

    chooseFile(el);
    fixture.detectChanges();

    expect(el.querySelector('.preview')?.getAttribute('src')).toBe('blob:picture');
    expect(placement.setPreview).toHaveBeenLastCalledWith('blob:picture');
  });

  it('sends the picture with its place and details, then says what happens next and clears the form', async () => {
    const placeMedia = vi.fn(() => Promise.resolve(added()));
    const { fixture, el, placement } = await adding({ placeMedia });
    const sent: IncidentMediaView[] = [];
    fixture.componentInstance.added.subscribe((p) => sent.push(p));
    chooseFile(el);
    typeInto(el, 'Caption', ' Nui Dat ');
    typeInto(el, 'Credit', 'J. Smith');
    typeInto(el, 'Date taken', '1966-08-18');
    placement.place.set({ lat: 10.49, lon: 107.2 });
    fixture.detectChanges();

    button(el, 'Send for approval').click();
    await settle(fixture);

    expect(placeMedia).toHaveBeenCalledWith(file, { lat: 10.49, lon: 107.2 }, 'Nui Dat', 'J. Smith', '1966-08-18');
    expect(sent.map((p) => p.id)).toEqual([90]);
    expect(text(el.querySelector('.sent'))).toContain('once an editor has looked at it');
    expect(placement.clear).toHaveBeenCalled();
    expect(button(el, 'Send for approval').disabled).toBe(true);
  });

  it('offers a look at the picture just sent', async () => {
    const { fixture, el, placement } = await adding({ placeMedia: vi.fn(() => Promise.resolve(added())) });
    const opened: unknown[] = [];
    fixture.componentInstance.openPicture.subscribe((p) => opened.push(p));
    chooseFile(el);
    placement.place.set({ lat: 10.49, lon: 107.2 });
    fixture.detectChanges();
    button(el, 'Send for approval').click();
    await settle(fixture);

    button(el, 'View it').click();

    expect(opened).toEqual([{ id: 90, lat: 10.49, lon: 107.2 }]);
  });

  it('tells an editor the picture is on the map at once', async () => {
    const { fixture, el, placement } = await adding({ placeMedia: vi.fn(() => Promise.resolve(added({ status: 'Approved' }))) }, ['editor']);
    chooseFile(el);
    placement.place.set({ lat: 10.49, lon: 107.2 });
    fixture.detectChanges();

    button(el, 'Add the image').click();
    await settle(fixture);

    expect(text(el.querySelector('.sent'))).toContain('Your image is on the map.');
  });

  it('says why a picture could not be sent, keeping what was entered', async () => {
    const { fixture, el, placement } = await adding({ placeMedia: vi.fn(() => Promise.reject(new Error('down'))) });
    chooseFile(el);
    placement.place.set({ lat: 10.49, lon: 107.2 });
    fixture.detectChanges();

    button(el, 'Send for approval').click();
    await settle(fixture);

    expect(text(el.querySelector('[role=alert]'))).toContain('could not be added');
    expect(placement.clear).not.toHaveBeenCalled();
  });

  it('takes the pin off the map when the panel closes', async () => {
    const { fixture, placement } = await adding();

    fixture.destroy();

    expect(placement.clear).toHaveBeenCalled();
  });
});

describe('the pictures panel in the Battle Map fly-out', () => {
  it('flies out from its tab, and is written into the link', async () => {
    const r = await render();
    [...r.el.querySelectorAll<HTMLButtonElement>('.bm__tabs [role=tab]')].find((t) => text(t) === 'Images')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('#left-flyout app-pictures-panel')).not.toBeNull();
    expect(r.el.querySelector('#left-flyout')?.classList).toContain('bm__flyout--roll');
  });

  it('opens on the images from images=1', async () => {
    const r = await render({ inputs: { images: '1' } });

    expect(r.el.querySelector('#left-flyout app-pictures-panel')).not.toBeNull();
  });

  it('opens a picture chosen in the panel in the viewer, leaving the map where it is', async () => {
    const r = await render({ community: { searchPictures: vi.fn(() => Promise.resolve({ items: [hit(3)], total: 1, page: 1, pageSize: 24 })) }, inputs: { images: '1' } });
    await settle(r.fixture);

    r.el.querySelector<HTMLButtonElement>('app-pictures-panel .hit')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-viewer')).not.toBeNull();
    expect(r.basemaps.flyTo).not.toHaveBeenCalled();
  });

  it("puts an editor's picture on the map as soon as it is added, but not one waiting for approval", async () => {
    const r = await render({ inputs: { images: '1' } });
    const panel = () => r.fixture.debugElement.query((d) => d.name === 'app-pictures-panel').componentInstance as PicturesPanel;
    const photos = r.basemaps.map.dataFor(PHOTO_SOURCE);

    panel().added.emit(added());
    expect(photos).not.toHaveBeenCalled();

    panel().added.emit(added({ status: 'Approved' }));
    expect(photos).toHaveBeenCalledTimes(1);
    expect(photos.mock.calls[0][0].features.map((f: { id: number }) => f.id)).toEqual([90]);
    await settle(r.fixture);
    expect(text(r.el.querySelector('#tabpanel'))).toContain('Community photos (1)');
  });
});
