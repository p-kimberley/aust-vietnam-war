import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { HonourSummary } from './community/community';
import type { Poi } from './poi';
import { CommunitySearchResult, FindResult, SearchService } from './search';
import { SearchBox } from './search-box';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEBOUNCE = 340;
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();

const BASES: Poi[] = [{ id: 1, type: 'FSB', name: 'Claymore', established: 1968, lat: 10.6, lon: 107.2 }];
const FOUND: FindResult = { total: 1, hits: [{ id: 10, dtg: '1966-08-18T16:07:00', snippet: [{ text: 'CLAYMORE', match: true }] }] };
const PEOPLE = { items: [{ serviceNumber: '5715978', name: 'James Claymor White', rank: 'Private', death: '1968-05-12' } as unknown as HonourSummary], total: 1 };
const COMMUNITY: CommunitySearchResult = {
  notes: [{ id: 3, contactId: 2, title: 'Ambush site', snippet: [{ text: 'Claymores', match: true }], authorName: 'A Member', createdUtc: '2018-01-01T00:00:00Z' }],
  noteTotal: 1,
  pictures: [{ id: 4, contactId: null, thumbUrl: '/media/ab/x-480.jpg', caption: 'A patrol', credit: 'AWM', lat: null, lon: null }],
  pictureTotal: 1,
};

function box(over: { community?: () => Promise<CommunitySearchResult>; people?: () => Promise<typeof PEOPLE>; find?: () => Promise<FindResult> } = {}) {
  TestBed.resetTestingModule();
  const service = {
    find: vi.fn(over.find ?? (() => Promise.resolve(FOUND))),
    people: vi.fn(over.people ?? (() => Promise.resolve(PEOPLE))),
    community: vi.fn(over.community ?? (() => Promise.resolve(COMMUNITY))),
  };
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: SearchService, useValue: service }] });
  const fixture: ComponentFixture<SearchBox> = TestBed.createComponent(SearchBox);
  fixture.componentRef.setInput('pois', BASES);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const input = el.querySelector<HTMLInputElement>('input.search__input')!;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const type = async (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(DEBOUNCE);
    await settle();
  };
  const types = () => el.querySelector<HTMLButtonElement>('.search__types')!;
  const openMenu = async () => {
    types().click();
    await settle();
  };
  const choice = (label: string) => [...el.querySelectorAll<HTMLLabelElement>('.search__kind-choice')].find((l) => text(l) === label)!.querySelector('input')!;
  const tick = async (label: string) => {
    choice(label).click();
    await settle();
  };
  const kinds = () => [...el.querySelectorAll('[role=option] .search__kind')].map((k) => text(k));
  return { fixture, el, input, service, settle, type, types, openMenu, choice, tick, kinds };
}

describe('the search icon', () => {
  it('sits inside the box, at the left, before the field, and is decoration', () => {
    const { el, input } = box();
    const icon = el.querySelector('.search__box > svg.search__icon')!;

    expect(icon).not.toBeNull();
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input.closest('.search__box')).toBe(icon.closest('.search__box'));
  });
});

describe('the kinds menu', () => {
  it('starts as "All types", shut, inside the box, and the placeholder names everything', () => {
    const { el, types, input } = box();

    expect(text(types())).toBe('All types');
    expect(types().closest('.search__box')).not.toBeNull();
    expect(types().getAttribute('aria-expanded')).toBe('false');
    expect(types().getAttribute('aria-label')).toBe('Kinds of thing to search for: All types');
    expect(types().classList.contains('is-limited')).toBe(false);
    expect(el.querySelector('.search__menu')).toBeNull();
    expect(input.getAttribute('placeholder')).toBe('Search bases, people, reports, notes and photos');
    expect(input.getAttribute('aria-label')).toBe('Search bases, people on the honour roll, incident reports, notes and photos');
  });

  it('opens a list of every kind to tick, none ticked, and says none ticked means everything', async () => {
    const { el, openMenu, types } = box();

    await openMenu();

    expect(types().getAttribute('aria-expanded')).toBe('true');
    const labels = [...el.querySelectorAll('.search__kind-choice')].map(text);
    expect(labels).toEqual(['Bases and landing zones', 'Honour roll', 'Incident reports', 'Incident notes', 'Photos']);
    expect([...el.querySelectorAll<HTMLInputElement>('.search__kind-choice input')].every((c) => c.type === 'checkbox' && !c.checked)).toBe(true);
    expect(text(el.querySelector('.search__menu-note'))).toContain('With none chosen, everything is searched');
    expect(el.querySelector('.search__everything')).toBeNull();
  });

  it('closes with Escape and puts focus back on the button, and closes when focus leaves the search', async () => {
    const { el, openMenu, fixture, types, settle } = box();

    await openMenu();
    el.querySelector('.search__menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(el.querySelector('.search__menu')).toBeNull();
    expect(document.activeElement).toBe(types());

    await openMenu();
    el.querySelector('.search')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    fixture.detectChanges();
    expect(el.querySelector('.search__menu')).toBeNull();
  });

  it('is closed again by pressing its button', async () => {
    const { el, openMenu, types, settle } = box();

    await openMenu();
    types().click();
    await settle();

    expect(el.querySelector('.search__menu')).toBeNull();
  });
});

describe('limiting what is searched for', () => {
  it('asks for everything, and shows everything, while nothing is ticked', async () => {
    const { service, type, kinds } = box();

    await type('claymor');

    expect(service.find).toHaveBeenCalledTimes(1);
    expect(service.people).toHaveBeenCalledTimes(1);
    expect(service.community).toHaveBeenCalledTimes(1);
    expect(kinds().length).toBe(5);                                       // a base, a person, an incident, a note and a photo
  });

  it('with only photos ticked, asks only for photos and shows only photos', async () => {
    const { service, type, openMenu, tick, kinds, types, input } = box();
    await type('claymor');

    await openMenu();
    await tick('Photos');

    expect(kinds()).toEqual(['Photo']);
    expect(text(types())).toBe('Photos');
    expect(types().classList.contains('is-limited')).toBe(true);
    expect(input.getAttribute('placeholder')).toBe('Search photos');
    expect(input.getAttribute('aria-label')).toBe('Search photos');
    // Typing again asks for photos and for nothing else.
    service.find.mockClear();
    service.people.mockClear();
    service.community.mockClear();
    await type('claymore');
    expect(service.find).not.toHaveBeenCalled();
    expect(service.people).not.toHaveBeenCalled();
    expect(service.community).toHaveBeenCalledExactlyOnceWith('claymore');
  });

  it('takes any number of kinds at once', async () => {
    const { service, type, openMenu, tick, kinds, types } = box();
    await type('claymor');
    await openMenu();

    await tick('Incident notes');
    await tick('Photos');

    expect(kinds()).toEqual(['Note', 'Photo']);
    expect(text(types())).toBe('2 types');
    expect(service.community).toHaveBeenCalled();
  });

  it('asks nothing of the server for bases alone, which are matched here', async () => {
    const { service, type, openMenu, tick, kinds } = box();
    await openMenu();
    await tick('Bases and landing zones');

    await type('claymor');

    expect(kinds()).toEqual(['Fire Support Base']);
    expect(service.find).not.toHaveBeenCalled();
    expect(service.people).not.toHaveBeenCalled();
    expect(service.community).not.toHaveBeenCalled();
  });

  it('leaves out the notes and photos request when neither is wanted, and the incident request when reports are not', async () => {
    const { service, type, openMenu, tick, kinds } = box();
    await openMenu();
    await tick('Incident reports');
    await tick('Honour roll');
    await type('claymor');

    expect(service.community).not.toHaveBeenCalled();
    expect(service.find).toHaveBeenCalled();
    expect(service.people).toHaveBeenCalled();
    expect(kinds().length).toBe(2);
  });

  it('searches again as soon as a kind is ticked, without waiting for typing to pause', async () => {
    const { service, type, openMenu, tick, settle } = box();
    await type('claymor');
    service.community.mockClear();

    await openMenu();
    await tick('Photos');
    await settle();

    expect(service.community).toHaveBeenCalledTimes(1);
  });

  it('treats every kind ticked as everything', async () => {
    const { types, openMenu, tick } = box();
    await openMenu();
    for (const label of ['Bases and landing zones', 'Honour roll', 'Incident reports', 'Incident notes', 'Photos']) {
      await tick(label);
    }

    expect(text(types())).toBe('All types');
    expect(types().classList.contains('is-limited')).toBe(false);
  });

  it('goes back to everything with "Search everything", and searches again', async () => {
    const { el, service, type, openMenu, tick, kinds, types, settle } = box();
    await type('claymor');
    await openMenu();
    await tick('Photos');
    expect(kinds()).toEqual(['Photo']);
    service.find.mockClear();

    el.querySelector<HTMLButtonElement>('.search__everything')!.click();
    await settle();

    expect(text(types())).toBe('All types');
    expect(service.find).toHaveBeenCalledTimes(1);
    expect([...el.querySelectorAll<HTMLInputElement>('.search__kind-choice input')].some((c) => c.checked)).toBe(false);
    expect(el.querySelector('.search__everything')).toBeNull();
    expect(document.activeElement).toBe(types());                        // not lost with the button that was pressed
  });

  it('shows the menu above the results, so a choice shows its effect at once, and closes the menu when typing resumes', async () => {
    const { el, type, openMenu, tick, kinds } = box();
    await type('claymor');

    await openMenu();
    const popup = el.querySelector('.search__popup')!;
    expect(popup.querySelector('.search__menu')).not.toBeNull();
    expect(popup.querySelector('[role=listbox]')).not.toBeNull();
    expect(popup.firstElementChild).toBe(popup.querySelector('.search__menu'));
    expect(kinds().length).toBe(5);

    await tick('Photos');
    expect(popup.querySelector('.search__menu')).not.toBeNull();                       // still open, to tick more
    expect(kinds()).toEqual(['Photo']);

    await type('claymore');
    expect(el.querySelector('.search__menu')).toBeNull();
    expect(el.querySelector('[role=listbox]')).not.toBeNull();
  });

  it('shows the menu even before anything has been typed', async () => {
    const { el, openMenu } = box();

    await openMenu();

    expect(el.querySelector('.search__popup .search__menu')).not.toBeNull();
    expect(el.querySelector('[role=listbox]')).toBeNull();
  });

  it('says nothing matches among the kinds chosen, and only says so when it is limited', async () => {
    const { el, type, openMenu, tick } = box({ community: () => Promise.resolve({ notes: [], noteTotal: 0, pictures: [], pictureTotal: 0 }) });
    await openMenu();
    await tick('Photos');

    await type('zzzz');

    expect(text(el.querySelector('.search__note'))).toBe('Nothing matches in the kinds chosen.');
  });

  it('says so when the only kind chosen cannot be searched, rather than that nothing matches', async () => {
    const { el, type, openMenu, tick } = box({ community: () => Promise.reject(new Error('down')) });
    await openMenu();
    await tick('Photos');

    await type('claymor');

    expect(text(el.querySelector('.search__note'))).toContain('The search failed');
  });

  it('still carries on without the extras when incident reports are searched too', async () => {
    const { el, type, openMenu, tick } = box({ community: () => Promise.reject(new Error('down')) });
    await openMenu();
    await tick('Photos');
    await tick('Incident reports');

    await type('claymor');

    expect(text(el.querySelector('.search__note'))).not.toContain('failed');
    expect(el.querySelectorAll('[role=option]')).toHaveLength(1);         // the incident
  });
});

describe('the clear button', () => {
  it('appears once there is text, and empties the field, the results and the search, returning focus to the field', async () => {
    const { el, input, type, settle, service } = box();
    expect(el.querySelector('.search__clear')).toBeNull();

    await type('claymor');
    const clear = el.querySelector<HTMLButtonElement>('.search__clear')!;
    expect(clear.getAttribute('aria-label')).toBe('Clear the search');
    service.find.mockClear();

    clear.click();
    await settle();

    expect(input.value).toBe('');
    expect(el.querySelector('.search__clear')).toBeNull();
    expect(el.querySelector('[role=listbox]')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(service.find).not.toHaveBeenCalled();
  });
});
