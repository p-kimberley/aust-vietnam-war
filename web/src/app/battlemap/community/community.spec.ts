import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HonourPerson, IncidentMediaView, NoteView, TributeView } from './community';
import { communityProviders, fakeAuth, fakeCommunity } from './community-testing';
import { HonourPanel } from './honour-panel';
import { NotesTab } from './notes-tab';
import { PeopleTab } from './people-tab';
import { PicturesTab } from './pictures-tab';

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(f: ComponentFixture<unknown>) {
  f.detectChanges();
  await f.whenStable();
  await wait();
  f.detectChanges();
}

const note = (over: Partial<NoteView> = {}): NoteView => ({
  id: 1,
  contactId: 2,
  title: 'Ambush site',
  body: 'Claymores were sited along the track.',
  authorName: 'Ann Member',
  createdUtc: '2026-03-01T00:00:00Z',
  updatedUtc: '2026-03-01T00:00:00Z',
  status: 'Approved',
  pendingEdit: false,
  mine: false,
  canEdit: false,
  commentsOpen: true,
  comments: [],
  ...over,
});

const picture = (over: Partial<IncidentMediaView> = {}): IncidentMediaView => ({
  id: 10,
  mediaId: 5,
  contactId: 2,
  url: '/media/aa/full.jpg',
  thumbUrl: '/media/aa/full-480.jpg',
  width: 800,
  height: 600,
  caption: 'A patrol',
  credit: 'AWM',
  dateTaken: '1966-08-18',
  lat: null,
  lon: null,
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

const person: HonourPerson = {
  serviceNumber: '5715978',
  name: 'James Mungo White',
  rank: 'Private',
  branch: 'Royal Australian Infantry Corps',
  birth: '1947-09-10',
  death: '1969-04-04',
  ageAtDeath: 21,
  portraitUrl: '/media/portraits/5715978.jpg',
  birthPlace: 'COLLIE',
  birthState: 'WESTERN AUSTRALIA',
  birthCountry: 'AUSTRALIA',
  nationalService: true,
  tours: [{ unit: '5th Battalion, The Royal Australian Regiment', start: '05/02/1969', end: '04/04/1969' }],
  incidents: [2, 9],
  tributes: 2,
};

const tribute = (over: Partial<TributeView> = {}): TributeView => ({ id: 1, authorName: 'Bo Member', message: 'Rest in peace.', createdUtc: '2026-03-01T00:00:00Z', mine: false, canDelete: false, ...over });

function mount<T>(component: new () => T, community: ReturnType<typeof fakeCommunity>, auth: ReturnType<typeof fakeAuth>, inputs: Record<string, unknown>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...communityProviders(community, auth)] });
  const fixture = TestBed.createComponent(component);
  for (const [k, v] of Object.entries(inputs)) {
    fixture.componentRef.setInput(k, v);
  }
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const button = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).startsWith(label))!;
const type = (el: HTMLElement, selector: string, value: string) => {
  const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = (el: HTMLElement, selector: string) => el.querySelector<HTMLFormElement>(selector)!.dispatchEvent(new Event('submit', { cancelable: true }));

afterEach(() => vi.restoreAllMocks());

describe('NotesTab', () => {
  it('shows approved notes and comments to a visitor, who is asked to sign in and gets no forms', async () => {
    const community = fakeCommunity({ notes: vi.fn(() => Promise.resolve([note({ comments: [{ id: 4, authorName: 'Bo Member', body: 'I remember that track.', createdUtc: '2026-03-02T00:00:00Z', mine: false, canDelete: false }] })])) });
    const auth = fakeAuth();
    const { fixture, el } = mount(NotesTab, community, auth, { contactId: 2 });
    const counted: number[] = [];
    fixture.componentInstance.counted.subscribe((n) => counted.push(n));
    await settle(fixture);

    expect(text(el.querySelector('article h4'))).toBe('Ambush site');
    expect(text(el)).toContain('Claymores were sited along the track.');
    expect(text(el)).toContain('I remember that track.');
    expect(counted).toEqual([1]);
    expect(el.querySelector('form')).toBeNull();
    button(el, 'Sign in').click();
    expect(auth.login).toHaveBeenCalled();
  });

  it('says when there are no notes yet', async () => {
    const { fixture, el } = mount(NotesTab, fakeCommunity(), fakeAuth(), { contactId: 2 });
    await settle(fixture);

    expect(text(el)).toContain('No notes have been added to this incident yet.');
  });

  it('shows the writer where their note stands', async () => {
    const community = fakeCommunity({
      notes: vi.fn(() => Promise.resolve([
        note({ id: 1, title: 'New one', status: 'Pending', mine: true, canEdit: true }),
        note({ id: 2, title: 'Changed one', status: 'Pending', pendingEdit: true, mine: true, canEdit: true }),
        note({ id: 3, title: 'Refused one', status: 'Rejected', mine: true, canEdit: true }),
      ])),
    });
    const { fixture, el } = mount(NotesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);

    expect([...el.querySelectorAll('.badge')].map((b) => text(b))).toEqual(['Waiting for approval', 'Change waiting', 'Not accepted']);
  });

  it('adds a note, then shows the list as the server has it and clears the form', async () => {
    const community = fakeCommunity({ createNote: vi.fn(() => Promise.resolve(note())) });
    const { fixture, el } = mount(NotesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);
    expect(text(el)).toContain('An editor reads new notes before they appear.');

    type(el, 'form input[type=text]', 'A title');
    type(el, 'form textarea', 'The body.');
    submit(el, 'form');
    await settle(fixture);

    expect(community['createNote']).toHaveBeenCalledWith(2, { title: 'A title', body: 'The body.' });
    expect(community['notes']).toHaveBeenCalledTimes(2);
    expect(el.querySelector<HTMLInputElement>('form input[type=text]')!.value).toBe('');
  });

  it('keeps what was typed and shows the reason when adding fails', async () => {
    const community = fakeCommunity({ createNote: vi.fn(() => Promise.reject({ status: 400 })) });
    const { fixture, el } = mount(NotesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);

    type(el, 'form input[type=text]', 'A title');
    type(el, 'form textarea', 'The body.');
    submit(el, 'form');
    await settle(fixture);

    expect(el.querySelector('[role=alert]')).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('form input[type=text]')!.value).toBe('A title');
  });

  it('lets the writer edit and save their note, or cancel', async () => {
    const community = fakeCommunity({
      notes: vi.fn(() => Promise.resolve([note({ mine: true, canEdit: true })])),
      updateNote: vi.fn(() => Promise.resolve(note())),
    });
    const { fixture, el } = mount(NotesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);

    button(el, 'Edit').click();
    await settle(fixture);
    // The edit form is the one with a title box; the comment form below it has only a text area.
    const editForm = () => el.querySelector('article form input[type=text]');
    expect(el.querySelector<HTMLTextAreaElement>('article form textarea')!.value).toBe('Claymores were sited along the track.');
    button(el, 'Cancel').click();
    await settle(fixture);
    expect(editForm()).toBeNull();

    button(el, 'Edit').click();
    await settle(fixture);
    type(el, 'article form textarea', 'Corrected.');
    submit(el, 'article form');
    await settle(fixture);

    expect(community['updateNote']).toHaveBeenCalledWith(1, { title: 'Ambush site', body: 'Corrected.' });
    expect(editForm()).toBeNull();
  });

  it('lets a note from the old site that is longer than a new one may be be edited, but not lengthened', async () => {
    const old = 'x'.repeat(12_000);
    const community = fakeCommunity({ notes: vi.fn(() => Promise.resolve([note({ body: old, mine: true, canEdit: true })])) });
    const { fixture, el } = mount(NotesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);

    button(el, 'Edit').click();
    await settle(fixture);
    const edit = el.querySelector<HTMLTextAreaElement>('article form textarea')!;
    expect(edit.getAttribute('maxlength')).toBe('12000');
    expect(edit.value).toHaveLength(12_000);
  });

  it('keeps the usual limit when editing a note that is not longer than that', async () => {
    const community = fakeCommunity({ notes: vi.fn(() => Promise.resolve([note({ mine: true, canEdit: true })])) });
    const { fixture, el } = mount(NotesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);

    button(el, 'Edit').click();
    await settle(fixture);

    expect(el.querySelector('article form textarea')!.getAttribute('maxlength')).toBe('5000');
  });

  it('deletes a note only after confirmation', async () => {
    const community = fakeCommunity({ notes: vi.fn(() => Promise.resolve([note({ mine: true, canEdit: true })])), deleteNote: vi.fn(() => Promise.resolve()) });
    const { fixture, el } = mount(NotesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);
    const confirm = vi.spyOn(window, 'confirm');

    confirm.mockReturnValueOnce(false);
    button(el, 'Delete').click();
    await settle(fixture);
    expect(community['deleteNote']).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    button(el, 'Delete').click();
    await settle(fixture);
    expect(community['deleteNote']).toHaveBeenCalledWith(1);
  });

  it('shows the history of a note to its writer, one click to open and one to close', async () => {
    const community = fakeCommunity({
      notes: vi.fn(() => Promise.resolve([note({ mine: true, canEdit: true })])),
      noteVersions: vi.fn(() => Promise.resolve([
        { versionNo: 2, title: 'Ambush site', body: 'Second text.', editedByName: 'Ann Member', createdUtc: '2026-03-02T00:00:00Z', approved: false },
        { versionNo: 1, title: 'Ambush site', body: 'First text.', editedByName: 'Ann Member', createdUtc: '2026-03-01T00:00:00Z', approved: true },
      ])),
    });
    const { fixture, el } = mount(NotesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);

    button(el, 'History').click();
    await settle(fixture);
    expect([...el.querySelectorAll('.history li')].map((li) => text(li))).toEqual([
      expect.stringContaining('Version 2 by Ann Member'),
      expect.stringContaining('Version 1 by Ann Member'),
    ]);
    expect(text(el.querySelectorAll('.history li')[1])).toContain('(approved)');

    button(el, 'Hide history').click();
    await settle(fixture);
    expect(el.querySelector('.history')).toBeNull();
  });

  it('lets an editor approve or reject a waiting note and close comments', async () => {
    const community = fakeCommunity({
      notes: vi.fn(() => Promise.resolve([note({ status: 'Pending' })])),
      moderateNote: vi.fn(() => Promise.resolve(note())),
      setCommentsOpen: vi.fn(() => Promise.resolve(note())),
    });
    const { fixture, el } = mount(NotesTab, community, fakeAuth({ authenticated: true, roles: ['editor'] }), { contactId: 2 });
    await settle(fixture);
    expect(text(el)).toContain('Notes from editors appear at once.');

    button(el, 'Approve').click();
    await settle(fixture);
    button(el, 'Reject').click();
    await settle(fixture);
    button(el, 'Close comments').click();
    await settle(fixture);

    expect(community['moderateNote']).toHaveBeenNthCalledWith(1, 1, 'Approved');
    expect(community['moderateNote']).toHaveBeenNthCalledWith(2, 1, 'Rejected');
    expect(community['setCommentsOpen']).toHaveBeenCalledWith(1, false);
  });

  it('shows moderation buttons to nobody but editors', async () => {
    const community = fakeCommunity({ notes: vi.fn(() => Promise.resolve([note({ status: 'Pending', mine: true, canEdit: true })])) });
    const { fixture, el } = mount(NotesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);

    expect(button(el, 'Approve')).toBeUndefined();
    expect(button(el, 'Close comments')).toBeUndefined();
  });

  it('adds and deletes comments, and says so when comments are closed', async () => {
    const open = note({ comments: [{ id: 4, authorName: 'Bo Member', body: 'Mine.', createdUtc: '2026-03-02T00:00:00Z', mine: true, canDelete: true }] });
    const community = fakeCommunity({
      notes: vi.fn(() => Promise.resolve([open])),
      addComment: vi.fn(() => Promise.resolve(open)),
      deleteComment: vi.fn(() => Promise.resolve(open)),
    });
    const { fixture, el } = mount(NotesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);

    type(el, 'article form textarea', 'A reply.');
    submit(el, 'article form');
    await settle(fixture);
    expect(community['addComment']).toHaveBeenCalledWith(1, 'A reply.');

    button(el, 'Delete comment').click();
    await settle(fixture);
    expect(community['deleteComment']).toHaveBeenCalledWith(4);

    const closed = mount(NotesTab, fakeCommunity({ notes: vi.fn(() => Promise.resolve([note({ commentsOpen: false })])) }), fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(closed.fixture);
    expect(text(closed.el)).toContain('Comments are closed on this note.');
    expect(closed.el.querySelector('article form')).toBeNull();
  });

  it('starts again when the incident changes, and ignores a slow answer for the old one', async () => {
    const pending: ((n: NoteView[]) => void)[] = [];
    const community = fakeCommunity({ notes: vi.fn(() => new Promise<NoteView[]>((resolve) => pending.push(resolve))) });
    const { fixture, el } = mount(NotesTab, community, fakeAuth(), { contactId: 2 });
    await settle(fixture);
    fixture.componentRef.setInput('contactId', 9);
    await settle(fixture);
    expect(pending).toHaveLength(2);

    pending[1]([note({ title: 'For nine' })]);
    await settle(fixture);
    pending[0]([note({ title: 'For two' })]);
    await settle(fixture);

    expect(text(el.querySelector('article h4'))).toBe('For nine');
  });

  it('says so when the notes cannot be loaded', async () => {
    const { fixture, el } = mount(NotesTab, fakeCommunity({ notes: vi.fn(() => Promise.reject(new Error('down'))) }), fakeAuth(), { contactId: 2 });
    await settle(fixture);

    expect(text(el.querySelector('[role=alert]'))).toBe('The notes could not be loaded.');
  });
});

describe('PicturesTab', () => {
  it('shows pictures with their captions, credits and likes, each opening in the viewer', async () => {
    const community = fakeCommunity({ media: vi.fn(() => Promise.resolve([picture(), picture({ id: 11, status: 'Pending', caption: null, likes: 0 })])) });
    const { fixture, el } = mount(PicturesTab, community, fakeAuth(), { contactId: 2 });
    const counted: number[] = [];
    fixture.componentInstance.counted.subscribe((n) => counted.push(n));
    await settle(fixture);

    const first = el.querySelector('figure')!;
    expect(first.querySelector('a')).toBeNull();                                   // not in another tab
    expect(first.querySelector('.open')?.getAttribute('aria-label')).toBe('View A patrol');
    expect(first.querySelector('img')?.getAttribute('src')).toBe('/media/aa/full-480.jpg');
    expect(first.querySelector('img')?.getAttribute('alt')).toBe('A patrol');
    expect(text(first)).toContain('AWM, 18 Aug 1966');
    expect(text(el.querySelectorAll('.badge')[0])).toBe('Waiting for approval');
    expect(counted).toEqual([2]);
    expect(el.querySelector('form')).toBeNull();                                   // a visitor cannot add or like
    expect(el.querySelector('.like')).toBeNull();
  });

  it('lets a member like and unlike a picture', async () => {
    const community = fakeCommunity({
      media: vi.fn(() => Promise.resolve([picture()])),
      toggleLike: vi.fn(() => Promise.resolve({ likes: 4, liked: true })),
    });
    const { fixture, el } = mount(PicturesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('.like')!.click();
    await settle(fixture);

    expect(community['toggleLike']).toHaveBeenCalledWith(10);
    expect(text(el.querySelector('.like'))).toBe('♥ 4');
    expect(el.querySelector('.like')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('uploads a picture with its caption, credit and date, then refreshes', async () => {
    const community = fakeCommunity({ addMedia: vi.fn(() => Promise.resolve(picture())) });
    const { fixture, el } = mount(PicturesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(el.querySelector('input[type=file]')!, 'files', { value: [file], configurable: true });
    type(el, 'form input[type=text]', 'A patrol');
    el.querySelector<HTMLInputElement>('form input[type=date]')!.value = '1966-08-18';

    submit(el, 'form');
    await settle(fixture);

    expect(community['addMedia']).toHaveBeenCalledWith(2, file, 'A patrol', '', '1966-08-18');
    expect(community['media']).toHaveBeenCalledTimes(2);
  });

  it('shows the reason when an upload is refused', async () => {
    const { HttpErrorResponse } = await import('@angular/common/http');
    const community = fakeCommunity({ addMedia: vi.fn(() => Promise.reject(new HttpErrorResponse({ status: 400, error: { detail: 'Upload a JPEG, PNG or WebP picture.' } }))) });
    const { fixture, el } = mount(PicturesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);
    Object.defineProperty(el.querySelector('input[type=file]')!, 'files', { value: [new File(['x'], 'a.svg')], configurable: true });

    submit(el, 'form');
    await settle(fixture);

    expect(text(el.querySelector('[role=alert]'))).toBe('Upload a JPEG, PNG or WebP picture.');
  });

  it('removes a picture after confirmation', async () => {
    const community = fakeCommunity({ media: vi.fn(() => Promise.resolve([picture({ canRemove: true })])), removeMedia: vi.fn(() => Promise.resolve()) });
    const { fixture, el } = mount(PicturesTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);
    const confirm = vi.spyOn(window, 'confirm');

    confirm.mockReturnValueOnce(false);
    button(el, 'Remove').click();
    await settle(fixture);
    expect(community['removeMedia']).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    button(el, 'Remove').click();
    await settle(fixture);
    expect(community['removeMedia']).toHaveBeenCalledWith(10);
  });
});

describe('PicturesTab viewer', () => {
  it("opens one of the incident's own pictures in the viewer, without moving the map", async () => {
    const community = fakeCommunity({ media: vi.fn(() => Promise.resolve([picture()])) });
    const { fixture, el } = mount(PicturesTab, community, fakeAuth(), { contactId: 2 });
    const chosen: unknown[] = [];
    fixture.componentInstance.openPicture.subscribe((n) => chosen.push(n));
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('figure .open')!.click();

    expect(chosen).toEqual([{ id: picture().id, lat: null, lon: null }]);
  });
});

describe('PicturesTab nearby photos', () => {
  const nearby = (over: Record<string, unknown> = {}) => ({
    id: 21, contactId: null, thumbUrl: '/media/bb/x-480.jpg', caption: 'A bunker by the road', credit: 'AWM', lat: 10.56, lon: 107.17, distanceMetres: 563, ...over,
  });

  it('shows photos taken near the incident, nearest first, with how far away each is', async () => {
    const community = fakeCommunity({ nearbyMedia: vi.fn(() => Promise.resolve([nearby(), nearby({ id: 22, caption: null, distanceMetres: 1234 }), nearby({ id: 23, distanceMetres: 950 })])) });
    const { fixture, el } = mount(PicturesTab, community, fakeAuth(), { contactId: 2 });
    await settle(fixture);

    expect(text(el.querySelector('h3'))).toBe('Photos taken nearby');
    const items = [...el.querySelectorAll('.nearby li')].map((li) => [...li.querySelectorAll('span')].map((x) => text(x)));
    expect(items).toEqual([['A bunker by the road', '560 m away'], ['Photo', '1.2 km away'], ['A bunker by the road', '950 m away']]);
    expect(el.querySelector('.nearby img')?.getAttribute('src')).toBe('/media/bb/x-480.jpg');
    expect(community['nearbyMedia']).toHaveBeenCalledWith(2);
  });

  it('tells the map which photo was chosen', async () => {
    const community = fakeCommunity({ nearbyMedia: vi.fn(() => Promise.resolve([nearby()])) });
    const { fixture, el } = mount(PicturesTab, community, fakeAuth(), { contactId: 2 });
    const chosen: number[] = [];
    fixture.componentInstance.openPicture.subscribe((n) => chosen.push(n.id));
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('.nearby button')!.click();

    expect(chosen).toEqual([21]);
  });

  it('shows nothing about nearby photos when there are none, or when they cannot be found', async () => {
    const none = mount(PicturesTab, fakeCommunity({ media: vi.fn(() => Promise.resolve([picture()])) }), fakeAuth(), { contactId: 2 });
    await settle(none.fixture);
    expect(none.el.querySelector('.nearby')).toBeNull();
    expect(text(none.el)).not.toContain('nearby');

    const broken = mount(PicturesTab, fakeCommunity({ media: vi.fn(() => Promise.resolve([picture()])), nearbyMedia: vi.fn(() => Promise.reject(new Error('down'))) }), fakeAuth(), { contactId: 2 });
    await settle(broken.fixture);
    expect(broken.el.querySelector('.nearby')).toBeNull();
    expect(broken.el.querySelector('figure')).not.toBeNull();                    // the incident's own pictures are unaffected
  });
});

describe('PeopleTab', () => {
  const people = [{ serviceNumber: '5715978', name: 'James Mungo White', rank: 'Private', branch: 'Royal Australian Infantry Corps', birth: null, death: null, ageAtDeath: null, portraitUrl: null }];

  it('lists the honour roll people linked to the incident, with a portrait where there is one, and opens one', async () => {
    const withPortrait = [{ ...people[0], portraitUrl: '/media/portraits/5715978.jpg' }];
    const { fixture, el } = mount(PeopleTab, fakeCommunity({ casualties: vi.fn(() => Promise.resolve(withPortrait)) }), fakeAuth(), { contactId: 2 });
    const opened: string[] = [];
    const counted: number[] = [];
    fixture.componentInstance.open.subscribe((s) => opened.push(s));
    fixture.componentInstance.counted.subscribe((n) => counted.push(n));
    await settle(fixture);

    const row = el.querySelector('.people li')!;
    expect(text(row.querySelector('.person__name'))).toBe('James Mungo White');
    expect(text(row.querySelector('.meta'))).toBe('Private, Royal Australian Infantry Corps');
    expect(row.querySelector('img.person__portrait')!.getAttribute('src')).toBe('/media/portraits/5715978.jpg');
    el.querySelector<HTMLButtonElement>('.people button')!.click();

    expect(opened).toEqual(['5715978']);
    expect(counted).toEqual([1]);
  });

  it('shows a silhouette in place of a portrait that has not been found', async () => {
    const { fixture, el } = mount(PeopleTab, fakeCommunity({ casualties: vi.fn(() => Promise.resolve(people)) }), fakeAuth(), { contactId: 2 });
    await settle(fixture);

    const row = el.querySelector('.people li')!;
    expect(row.querySelector('img.person__portrait')).toBeNull();
    expect(row.querySelector('.person__portrait--none')).not.toBeNull();
  });

  it('says when nobody is linked, and asks a visitor to sign in before telling us about a casualty', async () => {
    const auth = fakeAuth();
    const { fixture, el } = mount(PeopleTab, fakeCommunity(), auth, { contactId: 2 });
    await settle(fixture);

    expect(text(el)).toContain('No one on the honour roll is linked to this incident.');
    expect(el.querySelector('form')).toBeNull();
    button(el, 'Sign in').click();
    expect(auth.login).toHaveBeenCalled();
  });

  it('sends what a member knows about a casualty, with no service number when none is given', async () => {
    const community = fakeCommunity({ submitCasualty: vi.fn(() => Promise.resolve({})) });
    const { fixture, el } = mount(PeopleTab, community, fakeAuth({ authenticated: true, roles: ['member'] }), { contactId: 2 });
    await settle(fixture);
    expect([...el.querySelectorAll('option')].map((o) => text(o))).toEqual(['Choose…', 'Killed in action', 'Died of wounds', 'Wounded in action', 'Missing', 'Other']);

    type(el, 'select', 'Died of wounds');
    type(el, 'form textarea', 'Died at 8 Field Hospital.');
    submit(el, 'form');
    await settle(fixture);

    expect(community['submitCasualty']).toHaveBeenCalledWith(2, { serviceNumber: null, casualtyType: 'Died of wounds', comment: 'Died at 8 Field Hospital.' });
    expect(text(el)).toContain('Thank you.');
    expect(el.querySelector('form')).toBeNull();
  });
});

describe('HonourPanel', () => {
  function panel(community: ReturnType<typeof fakeCommunity>, auth = fakeAuth()) {
    return mount(HonourPanel, community, auth, { serviceNumber: '5715978' });
  }

  it('shows a poppy laid without words as a poppy, and counts it', async () => {
    const community = fakeCommunity({
      person: vi.fn(() => Promise.resolve(person)),
      tributes: vi.fn(() => Promise.resolve({ items: [tribute({ message: 'Thank you.' }), tribute({ id: 2, message: '', authorName: 'Member' })], total: 2, page: 1, pageSize: 20 })),
    });
    const { fixture, el } = panel(community);
    await settle(fixture);

    const cards = [...el.querySelectorAll('article.card')].map((c) => text(c));
    expect(cards[0]).toContain('Thank you.');
    expect(cards[1]).toContain('Laid a poppy.');
    expect(cards[1]).toContain('Member');
    expect(text(el)).toContain('Poppies (2)');
  });

  it('shows who the person was, their service, incidents and poppies', async () => {
    const community = fakeCommunity({
      person: vi.fn(() => Promise.resolve(person)),
      tributes: vi.fn(() => Promise.resolve({ items: [tribute(), tribute({ id: 2, message: 'Thank you.' })], total: 2, page: 1, pageSize: 20 })),
    });
    const { fixture, el } = panel(community);
    const opened: number[] = [];
    fixture.componentInstance.openIncident.subscribe((id) => opened.push(id));
    await settle(fixture);

    expect(text(el.querySelector('h2'))).toBe('James Mungo White');
    expect(el.querySelector('img.portrait')?.getAttribute('alt')).toBe('Portrait of James Mungo White');
    const facts = Object.fromEntries([...el.querySelectorAll('dt')].map((dt) => [text(dt), text(dt.nextElementSibling)]));
    expect(facts).toEqual({
      'Service number': '5715978',
      Rank: 'Private',
      Corps: 'Royal Australian Infantry Corps',
      Born: '10 Sep 1947, COLLIE, WESTERN AUSTRALIA, AUSTRALIA',
      Died: '4 Apr 1969, aged 21',
      Service: 'National Service',
    });
    expect(text(el.querySelector('.tours li'))).toContain('5th Battalion, The Royal Australian Regiment (05/02/1969 to 04/04/1969)');
    expect(text(el)).toContain('Poppies (2)');
    expect(el.querySelectorAll('article.card')).toHaveLength(2);

    button(el, 'Incident 9').click();
    expect(opened).toEqual([9]);
    expect(community['person']).toHaveBeenCalledWith('5715978');
  });

  it('lets a member place a poppy, which shows at once, and remove their own', async () => {
    const community = fakeCommunity({
      person: vi.fn(() => Promise.resolve(person)),
      leaveTribute: vi.fn(() => Promise.resolve(tribute({ id: 9, authorName: 'Ann Member', message: 'Lest we forget.', mine: true, canDelete: true }))),
      deleteTribute: vi.fn(() => Promise.resolve()),
    });
    const { fixture, el } = panel(community, fakeAuth({ authenticated: true, roles: ['member'] }));
    await settle(fixture);

    type(el, 'form textarea', 'Lest we forget.');
    submit(el, 'form');
    await settle(fixture);

    expect(community['leaveTribute']).toHaveBeenCalledWith('5715978', 'Lest we forget.');
    expect(text(el.querySelector('article.card'))).toContain('Lest we forget.');
    expect(text(el)).toContain('Poppies (1)');

    button(el, 'Remove').click();
    await settle(fixture);
    expect(community['deleteTribute']).toHaveBeenCalledWith(9);
    expect(text(el)).toContain('Poppies (0)');
    expect(text(el)).toContain('No one has left a poppy yet.');
  });

  it('asks a visitor to sign in to leave a poppy', async () => {
    const auth = fakeAuth();
    const { fixture, el } = panel(fakeCommunity({ person: vi.fn(() => Promise.resolve(person)) }), auth);
    await settle(fixture);

    expect(el.querySelector('form')).toBeNull();
    button(el, 'Sign in').click();
    expect(auth.login).toHaveBeenCalled();
  });

  it('shows more poppies a page at a time', async () => {
    const tributes = vi.fn((_sn: string, page: number) => Promise.resolve({ items: [tribute({ id: page, message: `Page ${page}` })], total: 2, page, pageSize: 1 }));
    const { fixture, el } = panel(fakeCommunity({ person: vi.fn(() => Promise.resolve(person)), tributes }));
    await settle(fixture);
    expect(el.querySelectorAll('article.card')).toHaveLength(1);

    button(el, 'Show more').click();
    await settle(fixture);

    expect(tributes).toHaveBeenLastCalledWith('5715978', 2);
    expect(el.querySelectorAll('article.card')).toHaveLength(2);
    expect(button(el, 'Show more')).toBeUndefined();
  });

  it('says so when the person cannot be found', async () => {
    const { fixture, el } = panel(fakeCommunity());
    await settle(fixture);

    expect(text(el.querySelector('[role=alert]'))).toContain('could not be loaded');
  });

  it('closes on request', async () => {
    const { fixture, el } = panel(fakeCommunity({ person: vi.fn(() => Promise.resolve(person)) }));
    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('.close')!.click();

    expect(closed).toBe(1);
  });
});
