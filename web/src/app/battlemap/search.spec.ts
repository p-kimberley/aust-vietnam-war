import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { POIS, render, settle } from './battlemap-testing';
import { HonourSummary } from './community/community';
import { Poi } from './poi';
import { CommunitySearchResult, FindResult, SearchService, matchPois } from './search';
import { SearchBox } from './search-box';

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE = 380; // the box waits 300 ms for typing to pause

const BASES: Poi[] = [
  { id: 1, type: 'FSB', name: 'Le Loi', established: 1970, lat: 10.63, lon: 107.24 },
  { id: 2, type: 'FSB', name: 'Coral', established: 1968, lat: 11.4, lon: 106.9 },
  { id: 3, type: 'FSPB', name: 'Coral Two', established: 1968, lat: 11.5, lon: 106.9 },
  { id: 4, type: 'FSB', name: 'Balmoral Coral Sea', established: 1968, lat: 11.6, lon: 106.9 },
  { id: 5, type: 'LZ', name: 'Hawk', established: null, lat: 10.5, lon: 107.1 },
];

const NO_COMMUNITY: CommunitySearchResult = { notes: [], noteTotal: 0, pictures: [], pictureTotal: 0 };

const FOUND: FindResult = {
  total: 327,
  hits: [
    { id: 10, dtg: '1966-08-18T16:07:00', snippet: [{ text: 'AT LOC ', match: false }, { text: 'CLAYMORE', match: true }, { text: ' FIRED', match: false }] },
    { id: 11, dtg: '1967-01-02T08:00:00', snippet: [{ text: 'A <b>claymore</b> line', match: false }] },
  ],
};

describe('matchPois', () => {
  it('finds bases by any words of their label, best first', () => {
    expect(matchPois(BASES, 'coral').map((p) => p.id)).toEqual([2, 3, 4]);   // starts-with first, then the rest by name
    expect(matchPois(BASES, 'fspb coral').map((p) => p.id)).toEqual([3]);      // the type is part of the label
    expect(matchPois(BASES, 'HAWK')[0].id).toBe(5);
  });

  it('returns nothing for empty or unmatched text, and honours the limit', () => {
    expect(matchPois(BASES, '')).toEqual([]);
    expect(matchPois(BASES, '   ')).toEqual([]);
    expect(matchPois(BASES, 'zzz')).toEqual([]);
    expect(matchPois(BASES, 'fsb', 2)).toHaveLength(2);
  });
});

const WHITE: HonourSummary = { serviceNumber: '5715978', name: 'James Mungo White', rank: 'Private', branch: 'Army', birth: null, death: '1969-04-04', ageAtDeath: null, portraitUrl: null };

describe('SearchBox honour roll', () => {
  function withPeople(people: (q: string) => Promise<{ items: HonourSummary[]; total: number }>) {
    TestBed.resetTestingModule();
    const service = { find: vi.fn(() => Promise.resolve(FOUND)), people: vi.fn(people), community: vi.fn(() => Promise.resolve(NO_COMMUNITY)) };
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: SearchService, useValue: service }] });
    const fixture: ComponentFixture<SearchBox> = TestBed.createComponent(SearchBox);
    fixture.componentRef.setInput('pois', BASES);
    fixture.detectChanges();
    const picked: string[] = [];
    fixture.componentInstance.pickPerson.subscribe((s) => picked.push(s));
    const el = fixture.nativeElement as HTMLElement;
    const run = async (value: string) => {
      const input = el.querySelector<HTMLInputElement>('input')!;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(DEBOUNCE);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { el, service, picked, run };
  }

  it('lists people on the honour roll between the bases and the incidents, and opens one', async () => {
    const { el, service, picked, run } = withPeople(() => Promise.resolve({ items: [WHITE], total: 1 }));

    await run('coral');

    expect(service.people).toHaveBeenCalledWith('coral');
    const kinds = [...el.querySelectorAll('[role=option]')].map((o) => text(o.querySelector('.search__kind')));
    expect(kinds.slice(0, 3)).toEqual(['Fire Support Base', 'Fire Support Patrol Base', 'Fire Support Base']);
    expect(kinds).toContain('Honour roll');
    expect(kinds.indexOf('Honour roll')).toBeLessThan(kinds.findIndex((k) => !!k?.includes('1966')));
    const person = [...el.querySelectorAll<HTMLElement>('[role=option]')].find((o) => !!text(o)?.includes('James Mungo White'))!;
    expect(text(person)).toContain('Private, died 1969');

    person.click();
    expect(picked).toEqual(['5715978']);
  });

  it('carries on with bases and incidents when the honour roll cannot be searched', async () => {
    const { el, run } = withPeople(() => Promise.reject(new Error('down')));

    await run('claymore');

    expect(el.querySelectorAll('[role=option]').length).toBeGreaterThan(0);
    expect(text(el.querySelector('.search__note'))).not.toContain('failed');
  });
});

describe('SearchService', () => {
  it('asks the honour roll for a few people at a time', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    const ctl = TestBed.inject(HttpTestingController);

    const result = TestBed.inject(SearchService).people('white', 3);
    const req = ctl.expectOne((r) => r.url === '/api/honour-roll');
    expect([req.request.params.get('q'), req.request.params.get('pageSize')]).toEqual(['white', '3']);
    req.flush({ items: [WHITE], total: 1, page: 1, pageSize: 3 });

    expect(await result).toEqual({ items: [WHITE], total: 1 });
  });
});

describe('SearchService', () => {
  it('asks for the words and a limit', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    const ctl = TestBed.inject(HttpTestingController);

    void TestBed.inject(SearchService).find('claymore ambush', 5);

    const req = ctl.expectOne((r) => r.url === '/api/contacts/find');
    expect(req.request.params.get('q')).toBe('claymore ambush');
    expect(req.request.params.get('limit')).toBe('5');
  });
});

describe('SearchBox', () => {
  function box(find: (q: string) => Promise<FindResult> = () => Promise.resolve(FOUND), people: (q: string) => Promise<{ items: HonourSummary[]; total: number }> = () => Promise.resolve({ items: [], total: 0 })) {
    TestBed.resetTestingModule();
    const service = { find: vi.fn(find), people: vi.fn(people), community: vi.fn(() => Promise.resolve(NO_COMMUNITY)) };
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: SearchService, useValue: service }] });
    const fixture: ComponentFixture<SearchBox> = TestBed.createComponent(SearchBox);
    fixture.componentRef.setInput('pois', BASES);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('input')!;
    const picked = { contacts: [] as number[], pois: [] as number[] };
    fixture.componentInstance.pickContact.subscribe((id) => picked.contacts.push(id));
    fixture.componentInstance.pickPoi.subscribe((id) => picked.pois.push(id));

    const type = async (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
    };
    const key = (k: string) => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      fixture.detectChanges();
    };
    const options = () => [...el.querySelectorAll('[role=option]')];
    const settleBox = async () => {
      await wait(DEBOUNCE);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, el, input, service, picked, type, key, options, settleBox };
  }

  it('is a labelled combobox that starts closed', () => {
    const { input, el } = box();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-label')).toContain('Search');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[role=listbox]')).toBeNull();
  });

  it('shows matching bases straight away, before any server answer', async () => {
    const { type, options, service } = box();

    await type('coral');

    expect(options().map((o) => [text(o.querySelector('.search__kind')), text(o.querySelector('.search__title'))])).toEqual([
      ['Fire Support Base', 'Coral'],
      ['Fire Support Patrol Base', 'Coral Two'],
      ['Fire Support Base', 'Balmoral Coral Sea'],
    ]);
    expect(service.find).not.toHaveBeenCalled();
  });

  it('waits for typing to pause, then adds incidents with the matched words marked', async () => {
    const { type, options, service, settleBox, el } = box();

    await type('cl');
    await type('claymore');
    await settleBox();

    expect(service.find).toHaveBeenCalledTimes(1);
    expect(service.find).toHaveBeenCalledWith('claymore');
    const incidents = options().filter((o) => o.querySelector('.search__snippet'));
    expect(incidents).toHaveLength(2);
    expect(text(incidents[0].querySelector('.search__kind'))).toBe('18 Aug 1966 16:07');
    expect(text(incidents[0].querySelector('mark'))).toBe('CLAYMORE');
    expect(text(el.querySelector('.search__note'))).toContain('Showing the best 2 of 327 incidents');
  });

  it('shows excerpts as text, never as markup', async () => {
    const { type, options, settleBox } = box();
    await type('claymore');
    await settleBox();

    const second = options().find((o) => text(o)?.includes('A <b>claymore</b> line'))!;
    expect(second.querySelector('b')).toBeNull();
  });

  it('does not search for text that is too short', async () => {
    const { type, service, options } = box();

    await type('c');
    await wait(DEBOUNCE);

    expect(service.find).not.toHaveBeenCalled();
    expect(options()).toHaveLength(0);
  });

  it('says when nothing matches, and when the search fails', async () => {
    const none = box(() => Promise.resolve({ hits: [], total: 0 }));
    await none.type('zzz');
    await none.settleBox();
    expect(text(none.el.querySelector('.search__note'))).toBe('Nothing matches.');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = box(() => Promise.reject(new Error('down')));
    await broken.type('claymore');
    await broken.settleBox();
    expect(text(broken.el.querySelector('.search__note'))).toContain('The search failed');
    warn.mockRestore();
  });

  it('ignores a slow answer to an older search', async () => {
    const pending: ((r: FindResult) => void)[] = [];
    const { type, options, settleBox, fixture } = box(() => new Promise<FindResult>((resolve) => pending.push(resolve)));

    await type('first');
    await wait(DEBOUNCE);
    await type('second');
    await wait(DEBOUNCE);
    expect(pending).toHaveLength(2);

    pending[1]({ total: 1, hits: [FOUND.hits[1]] });
    await settleBox();
    pending[0](FOUND);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(options().filter((o) => o.querySelector('.search__snippet'))).toHaveLength(1);
  });

  it('moves through the results with the arrow keys and opens one with Enter', async () => {
    const { type, key, options, picked, input, fixture } = box();
    await type('coral');

    key('ArrowDown');
    key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('search-option-1');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    key('ArrowUp');
    key('ArrowUp');                                            // wraps to the last
    expect(input.getAttribute('aria-activedescendant')).toBe('search-option-2');
    key('ArrowDown');                                          // and wraps back to the first
    key('Enter');

    expect(picked.pois).toEqual([2]);
    expect(picked.contacts).toEqual([]);
    expect(fixture.nativeElement.querySelector('[role=listbox]')).toBeNull();     // the list closes after a choice
  });

  it('opens an incident by clicking it', async () => {
    const { type, options, picked, settleBox } = box();
    await type('claymore');
    await settleBox();

    (options().find((o) => o.querySelector('.search__snippet')) as HTMLElement).click();

    expect(picked.contacts).toEqual([10]);
  });

  it('closes on Escape and does nothing on Enter with no choice', async () => {
    const { type, key, picked, el } = box();
    await type('coral');

    key('Enter');
    expect(picked.pois).toEqual([]);
    key('Escape');

    expect(el.querySelector('[role=listbox]')).toBeNull();
  });
});

describe('Battle Map search', () => {
  it('flies to a base chosen in the search box and opens its panel', async () => {
    const r = await render({});
    const box = r.el.querySelector<HTMLInputElement>('app-search-box input')!;

    box.value = 'hawk';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(r.fixture);
    r.el.querySelector<HTMLElement>('[role=option]')!.click();
    await settle(r.fixture);

    expect(r.basemaps.flyTo).toHaveBeenCalledWith(POIS[1].lat, POIS[1].lon, 13);
    expect(r.el.querySelector('app-poi-panel')).not.toBeNull();
  });

  it('does not show the search box until the map is ready', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await render({ contacts: new Error('down') });

    expect(r.el.querySelector('app-search-box')).toBeNull();
    warn.mockRestore();
  });
});
