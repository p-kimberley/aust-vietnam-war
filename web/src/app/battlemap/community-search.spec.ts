import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';
import { render, settle } from './battlemap-testing';
import { HonourSummary } from './community/community';
import { CommunitySearchResult, FindResult, PictureHit, SearchService } from './search';
import { SearchBox } from './search-box';

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE = 380;

const NONE: FindResult = { total: 0, hits: [] };

const FOUND: CommunitySearchResult = {
  notes: [
    {
      id: 100,
      contactId: 2,
      title: 'Ambush site',
      snippet: [{ text: '…sited along the track. ', match: false }, { text: 'Claymores', match: true }, { text: ' were <b>armed</b>…', match: false }],
      authorName: 'Ann Member',
      createdUtc: '2011-05-04T10:30:00Z',
    },
  ],
  noteTotal: 1,
  pictures: [
    { id: 703, contactId: null, thumbUrl: '/media/ab/x-480.jpg', caption: 'A patrol at Nui Dat', credit: 'AWM', lat: 10.5979, lon: 107.0504 },
    { id: 704, contactId: 9, thumbUrl: '/media/cd/y-480.jpg', caption: null, credit: null, lat: null, lon: null },
  ],
  pictureTotal: 2,
};

describe('SearchService community search', () => {
  it('asks for the words and a few of each kind', async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    const ctl = TestBed.inject(HttpTestingController);

    const result = TestBed.inject(SearchService).community('claymor track');
    const req = ctl.expectOne((r) => r.url === '/api/community-search');
    expect([req.request.params.get('q'), req.request.params.get('limit')]).toEqual(['claymor track', '4']);
    req.flush(FOUND);

    expect(await result).toEqual(FOUND);
  });
});

describe('SearchBox notes and photos', () => {
  function box(community: () => Promise<CommunitySearchResult> = () => Promise.resolve(FOUND), find: () => Promise<FindResult> = () => Promise.resolve(NONE)) {
    TestBed.resetTestingModule();
    const service = {
      find: vi.fn(find),
      people: vi.fn(() => Promise.resolve({ items: [] as HonourSummary[], total: 0 })),
      community: vi.fn(community),
    };
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: SearchService, useValue: service }] });
    const fixture: ComponentFixture<SearchBox> = TestBed.createComponent(SearchBox);
    fixture.componentRef.setInput('pois', []);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const notes: number[] = [];
    const pictures: PictureHit[] = [];
    fixture.componentInstance.pickNote.subscribe((id) => notes.push(id));
    fixture.componentInstance.pickPicture.subscribe((p) => pictures.push(p));
    const input = el.querySelector<HTMLInputElement>('input')!;
    const run = async (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(DEBOUNCE);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const options = () => [...el.querySelectorAll<HTMLElement>('[role=option]')];
    return { fixture, el, input, service, notes, pictures, run, options };
  }

  it('lists notes and photos with what matched marked, after the incidents', async () => {
    const found: FindResult = { total: 1, hits: [{ id: 10, dtg: '1966-08-18T16:07:00', snippet: [{ text: 'CLAYMORE', match: true }] }] };
    const { service, run, options } = box(undefined, () => Promise.resolve(found));

    await run('claymor');

    expect(service.community).toHaveBeenCalledWith('claymor');
    const kinds = options().map((o) => text(o.querySelector('.search__kind')));
    expect(kinds.slice(1)).toEqual(['Note', 'Photo', 'Photo']);                        // after the one incident
    const note = options()[1];
    expect(text(note.querySelector('.search__title'))).toBe('Ambush site');
    expect([...note.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['Claymores']);
    const photo = options()[2];
    expect(text(photo)).toContain('A patrol at Nui Dat');
    expect(text(photo)).toContain('AWM');
    expect(photo.querySelector('img')?.getAttribute('src')).toBe('/media/ab/x-480.jpg');
    expect(photo.querySelector('img')?.getAttribute('alt')).toBe('');                  // decorative: the caption beside it says it
    expect(text(options()[3])).toContain('Photo');                                     // a photo with no caption still has a name
  });

  it('shows what a note says as text, never as markup', async () => {
    const { el, run } = box();

    await run('claymor');

    expect(el.querySelector('.search__snippet b')).toBeNull();
    expect(text(el.querySelector('.search__snippet'))).toContain('<b>armed</b>');
  });

  it('opens the incident a note is about, and a photo where it was taken', async () => {
    const { notes, pictures, run, options } = box();

    await run('claymor');
    options()[0].click();
    await run('claymor');
    options()[1].click();

    expect(notes).toEqual([2]);
    expect(pictures.map((p) => [p.id, p.lat, p.lon])).toEqual([[703, 10.5979, 107.0504]]);
  });

  it('can be moved through and chosen from the keyboard', async () => {
    const { fixture, input, notes, run } = box();
    await run('claymor');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(notes).toEqual([2]);
  });

  it('carries on with everything else when notes and photos cannot be searched', async () => {
    const found: FindResult = { total: 1, hits: [{ id: 10, dtg: '1966-08-18T16:07:00', snippet: [{ text: 'CLAYMORE', match: true }] }] };
    const { el, run, options } = box(() => Promise.reject(new Error('down')), () => Promise.resolve(found));

    await run('claymor');

    expect(options()).toHaveLength(1);
    expect(text(el.querySelector('.search__note'))).not.toContain('failed');
  });

  it('says nothing matches only when nothing of any kind does', async () => {
    const empty = box(() => Promise.resolve({ notes: [], noteTotal: 0, pictures: [], pictureTotal: 0 }));
    await empty.run('zzzz');
    expect(text(empty.el.querySelector('.search__note'))).toBe('Nothing matches.');

    const some = box();
    await some.run('claymor');
    expect(text(some.el.querySelector('.search__note'))).not.toContain('Nothing');
  });

  it('says what it searches', () => {
    const { input } = box();

    expect(input.getAttribute('placeholder')).toBe('Search bases, people, reports, notes and photos');
    expect(input.getAttribute('aria-label')).toContain('notes and photos');
  });
});

describe('Battle Map: finding notes and photos', () => {
  const searchBox = (r: Awaited<ReturnType<typeof render>>) => r.fixture.debugElement.query(By.directive(SearchBox)).componentInstance as SearchBox;

  it('opens a found note on its incident\'s notes, then a different incident on its details', async () => {
    const r = await render({});

    searchBox(r).pickNote.emit(2);
    await settle(r.fixture);

    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
    const selected = () => text(r.el.querySelector('app-incident-panel [role=tab][aria-selected=true]'));
    expect(selected()).toContain('Notes');
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(10.55, 107.16, 13);

    r.basemaps.clickHandler!({ id: 9 });
    await settle(r.fixture);
    expect(selected()).toBe('Details');
  });

  it('opens a found photo and brings its place into view', async () => {
    const r = await render({});

    searchBox(r).pickPicture.emit({ id: 703, contactId: null, thumbUrl: '', caption: 'A patrol', credit: null, lat: 10.5979, lon: 107.0504 });
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-panel')).not.toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(10.5979, 107.0504, 15);
  });

  it('opens a found photo that has no place without moving the map', async () => {
    const r = await render({});

    searchBox(r).pickPicture.emit({ id: 704, contactId: 9, thumbUrl: '', caption: null, credit: null, lat: null, lon: null });
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-panel')).not.toBeNull();
    expect(r.basemaps.flyTo).not.toHaveBeenCalled();
  });

  it('opens a photo taken near an incident from the incident\'s pictures', async () => {
    const community = { nearbyMedia: vi.fn(() => Promise.resolve([{ id: 21, contactId: null, thumbUrl: '/media/bb/x-480.jpg', caption: 'A bunker', credit: null, lat: 10.56, lon: 107.17, distanceMetres: 563 }])) };
    const r = await render({ community, inputs: { incident: '2' } });
    [...r.el.querySelectorAll<HTMLButtonElement>('[role=tab]')].find((t) => text(t)?.startsWith('Pictures'))!.click();
    await settle(r.fixture);

    r.el.querySelector<HTMLButtonElement>('app-incident-panel .nearby button')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-picture-panel')).not.toBeNull();
    expect(r.el.querySelector('app-incident-panel')).toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalledWith(10.56, 107.17, 15);
  });
});
