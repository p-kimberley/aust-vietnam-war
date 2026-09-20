import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, input, output, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../core/auth.service';
import { ArticleEditor, AUTOSAVE_MS, defaultScheduleValue } from './article-editor';
import { MediaLibrary } from './media-library';
import { RichText } from './rich-text';
import { StudioArticles } from './studio-articles';
import { ArticleEdit, MediaView, StudioApi, isConflict, problemMessage } from './studio-api';

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const edit = (over: Partial<ArticleEdit> = {}): ArticleEdit => ({
  id: 7,
  kind: 'Article',
  slug: 'long-tan',
  title: 'Long Tan',
  excerpt: null,
  bodyHtml: '<p>Body.</p>',
  status: 'Draft',
  authorId: 1,
  authorName: 'Ann Author',
  categoryId: null,
  featuredMediaId: null,
  featuredMediaUrl: null,
  featureOnHomepage: false,
  parentId: null,
  sortOrder: 0,
  seoTitle: null,
  seoDescription: null,
  tags: ['Nui Dat'],
  publishedUtc: null,
  scheduledUtc: null,
  createdUtc: '2026-03-01T00:00:00Z',
  updatedUtc: '2026-03-02T00:00:00Z',
  version: 3,
  canEdit: true,
  transitions: ['InReview'],
  ...over,
});

const media = (over: Partial<MediaView> = {}): MediaView => ({
  id: 1,
  url: '/media/aa/one.jpg',
  thumbUrl: '/media/aa/one-480.jpg',
  width: 800,
  height: 600,
  caption: 'A patrol',
  credit: null,
  status: 'Approved',
  uploadedByName: 'Ann Author',
  mine: true,
  createdUtc: '2026-03-01T00:00:00Z',
  ...over,
});

const problem = (status: number, detail: string) => new HttpErrorResponse({ status, error: { detail } });

describe('problemMessage and isConflict', () => {
  it('uses the server\'s explanation when there is one', () => {
    expect(problemMessage(problem(400, 'Give it a title.'))).toBe('Give it a title.');
    expect(isConflict(problem(409, 'x'))).toBe(true);
    expect(isConflict(problem(400, 'x'))).toBe(false);
  });

  it('has plain fallbacks for other failures', () => {
    expect(problemMessage(new HttpErrorResponse({ status: 0 }))).toContain('could not be reached');
    expect(problemMessage(new HttpErrorResponse({ status: 413 }))).toContain('too large');
    expect(problemMessage(new Error('x'), 'Custom.')).toBe('Custom.');
  });
});

describe('StudioApi', () => {
  function setup() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    return { api: TestBed.inject(StudioApi), ctl: TestBed.inject(HttpTestingController) };
  }

  it('sends only the filters that are set', () => {
    const { api, ctl } = setup();
    void api.list({ status: 'Draft', kind: '', q: '', page: 2 });

    const req = ctl.expectOne((r) => r.url === '/api/studio/articles');
    expect(req.request.params.keys().sort()).toEqual(['page', 'pageSize', 'status']);
    expect(req.request.params.get('status')).toBe('Draft');
  });

  it('creates with the kind in the query and updates in place', () => {
    const { api, ctl } = setup();
    const input = { title: 'T', slug: null, excerpt: null, bodyHtml: '', categoryId: null, featuredMediaId: null, featureOnHomepage: false, parentId: null, sortOrder: 0, seoTitle: null, seoDescription: null, tags: [], version: 0 };

    void api.create('Page', input);
    expect(ctl.expectOne((r) => r.url === '/api/studio/articles' && r.method === 'POST').request.params.get('kind')).toBe('Page');
    void api.update(5, input);
    expect(ctl.expectOne('/api/studio/articles/5').request.method).toBe('PUT');
  });

  it('moves an item with the version it was loaded at', () => {
    const { api, ctl } = setup();
    void api.transition(5, 'Scheduled', 4, '2026-10-01T00:00:00.000Z');

    expect(ctl.expectOne('/api/studio/articles/5/status').request.body).toEqual({ status: 'Scheduled', version: 4, scheduledUtc: '2026-10-01T00:00:00.000Z' });
  });

  it('uploads a picture as a multipart form with the caption and credit', () => {
    const { api, ctl } = setup();
    void api.uploadMedia(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), 'A patrol', '');

    const body = ctl.expectOne('/api/studio/media').request.body as FormData;
    expect((body.get('file') as File).name).toBe('a.jpg');
    expect(body.get('caption')).toBe('A patrol');
    expect(body.has('credit')).toBe(false);
  });
});

describe('StudioArticles', () => {
  function setup(role: 'author' | 'editor') {
    TestBed.resetTestingModule();
    const list = vi.fn(() => Promise.resolve({ items: [
      { id: 1, kind: 'Article', slug: 'a', title: 'First', status: 'Published', authorName: 'Ann', categoryName: null, publishedUtc: null, scheduledUtc: null, updatedUtc: '2026-03-01T00:00:00Z' },
      { id: 2, kind: 'Page', slug: 'b', title: 'About', status: 'Scheduled', authorName: 'Ed', categoryName: null, publishedUtc: null, scheduledUtc: '2026-10-01T00:00:00Z', updatedUtc: '2026-03-01T00:00:00Z' },
    ], total: 45, page: 1, pageSize: 20 }));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: StudioApi, useValue: { list } },
        { provide: AuthService, useValue: { hasRole: (r: string) => r === 'author' || role === 'editor' } },
      ],
    });
    const fixture = TestBed.createComponent(StudioArticles);
    return { fixture, list, el: fixture.nativeElement as HTMLElement };
  }

  async function settle(f: ComponentFixture<unknown>) {
    await wait();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  }

  it('lists items with their status and links each to its editor', async () => {
    const { fixture, el } = setup('editor');
    await settle(fixture);

    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/studio/articles/1');
    expect(rows[1].textContent).toContain('Page');
    expect(rows[1].textContent).toContain('Scheduled');
    expect(el.querySelector('.pager')?.textContent).toContain('Page 1 of 3');
  });

  it('offers new pages and a type filter only to editors', async () => {
    const editor = setup('editor');
    await settle(editor.fixture);
    expect(editor.el.textContent).toContain('New page');
    expect(editor.el.textContent).toContain('Articles and pages');

    const author = setup('author');
    await settle(author.fixture);
    expect(author.el.textContent).not.toContain('New page');
    expect(author.el.textContent).toContain('Your articles');
    expect(author.el.querySelectorAll('select')).toHaveLength(1);
  });

  it('asks again from the first page when a filter changes', async () => {
    const { fixture, list, el } = setup('editor');
    await settle(fixture);

    const select = el.querySelector<HTMLSelectElement>('select')!;
    select.value = 'Draft';
    select.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(list).toHaveBeenLastCalledWith({ status: 'Draft', kind: '', q: '', page: 1 });
  });
});

@Component({ selector: 'app-rich-text', template: '' })
class StubRichText {
  readonly html = input.required<string>();
  readonly disabled = input(false);
  readonly changed = output<string>();
  readonly pickImage = output<void>();
  readonly insertImage = vi.fn();
}

describe('ArticleEditor', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  async function open(id: string, roles: 'author' | 'editor' = 'editor', found?: ArticleEdit | Error | HttpErrorResponse, kind?: string) {
    TestBed.resetTestingModule();
    api = {
      get: vi.fn(() => (found instanceof Error || found instanceof HttpErrorResponse ? Promise.reject(found) : Promise.resolve(found ?? edit()))),
      create: vi.fn((_kind: string, input: { title: string }) => Promise.resolve(edit({ id: 9, title: input.title, version: 1 }))),
      update: vi.fn((_id: number, input: { title: string; version: number; featuredMediaId: number | null; categoryId: number | null }) =>
        Promise.resolve(edit({
          title: input.title,
          version: input.version + 1,
          featuredMediaId: input.featuredMediaId,
          featuredMediaUrl: input.featuredMediaId ? '/media/aa/one.jpg' : null,
          categoryId: input.categoryId,
        }))),
      transition: vi.fn((_id: number, status: ArticleEdit['status'], version: number) => Promise.resolve(edit({ status, version: version + 1, transitions: ['Draft'] }))),
      remove: vi.fn(() => Promise.resolve()),
      revisions: vi.fn(() => Promise.resolve([{ revisionNo: 2, title: 'Newer', authorName: 'Ann', createdUtc: '2026-03-02T00:00:00Z' }, { revisionNo: 1, title: 'Older', authorName: 'Ann', createdUtc: '2026-03-01T00:00:00Z' }])),
      revision: vi.fn((_id: number, no: number) => Promise.resolve({ revisionNo: no, title: 'Older', bodyHtml: '<p>Old body.</p>', authorName: 'Ann', createdUtc: '2026-03-01T00:00:00Z' })),
      restore: vi.fn((_id: number, _no: number, version: number) => Promise.resolve(edit({ title: 'Older', bodyHtml: '<p>Old body.</p>', version: version + 1 }))),
      categories: vi.fn(() => Promise.resolve([{ id: 1, slug: 'battles', name: 'Battles' }])),
      createCategory: vi.fn(() => Promise.resolve({ id: 2, slug: 'new', name: 'New' })),
      list: vi.fn(() => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 100 })),
      media: vi.fn(() => Promise.resolve({ items: [media({ id: 1 }), media({ id: 2, status: 'Pending', url: '/media/bb/two.jpg' })], total: 2, page: 1, pageSize: 24 })),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: StudioApi, useValue: api },
        { provide: AuthService, useValue: { hasRole: (r: string) => r === 'author' || roles === 'editor' } },
      ],
    });
    TestBed.overrideComponent(ArticleEditor, { remove: { imports: [RichText] }, add: { imports: [StubRichText] } });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;
    const fixture = TestBed.createComponent(ArticleEditor);
    fixture.componentRef.setInput('id', id);
    if (kind) {
      fixture.componentRef.setInput('kind', kind);
    }
    await flush(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement, page: fixture.componentInstance as unknown as Record<string, () => unknown> & { picker: { set(v: string | null): void } } };
  }

  async function flush(f: ComponentFixture<unknown>, ms = 0) {
    for (let i = 0; i < 4; i++) {
      f.detectChanges();
      await vi.advanceTimersByTimeAsync(ms);
    }
    await f.whenStable();
    f.detectChanges();
  }

  const type = (el: HTMLElement, selector: string, value: string, event = 'input') => {
    const field = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event(event, { bubbles: true }));
  };

  const click = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith(text))!.click();

  const status = (el: HTMLElement) => el.querySelector('.saved')?.textContent?.trim();

  it('starts a new article empty, saves it once it has a title, then moves to its own address', async () => {
    const { fixture, el } = await open('new');
    expect(status(el)).toBe('');
    expect(el.textContent).toContain('Saved automatically once it has a title');

    type(el, '.title input', 'The Battle of Long Tan');
    fixture.detectChanges();
    expect(status(el)).toBe('Unsaved changes');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 100);
    expect(api['create']).not.toHaveBeenCalled();

    await flush(fixture, 200);

    expect(api['create']).toHaveBeenCalledOnce();
    expect(api['create'].mock.calls[0][0]).toBe('Article');
    expect(api['create'].mock.calls[0][1]).toMatchObject({ title: 'The Battle of Long Tan', version: 0, tags: [] });
    expect(navigate).toHaveBeenCalledWith(['/studio/articles', 9], { replaceUrl: true });
    expect(status(el)).toBe('All changes saved');
  });

  it('creates a page when asked to, and lets an editor choose where it sits', async () => {
    const { fixture, el } = await open('new', 'editor', undefined, 'Page');
    expect(el.querySelector('h1')?.textContent).toBe('Page');
    expect(el.textContent).toContain('Sits under');
    expect(el.textContent).not.toContain('Main picture');

    type(el, '.title input', 'About');
    await flush(fixture, AUTOSAVE_MS + 100);

    expect(api['create'].mock.calls[0][0]).toBe('Page');
  });

  it('does not save an untitled draft and says why', async () => {
    const { fixture, el } = await open('new');

    type(el, 'textarea', 'A summary only');
    await flush(fixture, AUTOSAVE_MS + 100);

    expect(api['create']).not.toHaveBeenCalled();
    expect(el.querySelector('.banner')?.textContent).toContain('Give it a title');
  });

  it('opens an existing item with its details filled in', async () => {
    const { el } = await open('7');

    expect(el.querySelector<HTMLInputElement>('.title input')!.value).toBe('Long Tan');
    expect(el.querySelector('.status')?.textContent?.trim()).toBe('Draft');
    expect(el.textContent).toContain('By Ann Author');
    expect(el.querySelector<HTMLInputElement>('input[placeholder="Comma separated"]')!.value).toBe('Nui Dat');
    expect(api['get']).toHaveBeenCalledWith(7);
  });

  it('says so when the item cannot be opened', async () => {
    const { el } = await open('99', 'editor', problem(404, 'There is no such item.'));

    expect(el.querySelector('[role=alert]')?.textContent).toContain('There is no such item.');
    expect(el.querySelector('.title')).toBeNull();
  });

  it('saves changes with the version it loaded and keeps the newer version for the next save', async () => {
    const { fixture, el } = await open('7');

    type(el, '.title input', 'Long Tan, 1966');
    await flush(fixture, AUTOSAVE_MS + 100);
    type(el, '.title input', 'Long Tan, August 1966');
    await flush(fixture, AUTOSAVE_MS + 100);

    expect(api['update'].mock.calls.map((c) => [c[0], c[1].title, c[1].version])).toEqual([
      [7, 'Long Tan, 1966', 3],
      [7, 'Long Tan, August 1966', 4],
    ]);
  });

  it('shows a conflict clearly and offers the latest copy instead of overwriting', async () => {
    const { fixture, el } = await open('7');
    api['update'].mockRejectedValueOnce(problem(409, 'Someone else has changed this item since you opened it.'));

    type(el, '.title input', 'Mine');
    await flush(fixture, AUTOSAVE_MS + 100);

    expect(status(el)).toBe('Not saved: out of date');
    expect(el.querySelector('.banner')?.textContent).toContain('Someone else has changed');

    click(el, 'Load the latest');
    await flush(fixture);
    expect(api['get']).toHaveBeenCalledTimes(2);
    expect(el.querySelector<HTMLInputElement>('.title input')!.value).toBe('Long Tan');
    expect(status(el)).toBe('');
  });

  it('keeps the text and retries when a save fails', async () => {
    const { fixture, el } = await open('7');
    api['update'].mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

    type(el, '.title input', 'Mine');
    await flush(fixture, AUTOSAVE_MS + 100);
    expect(status(el)).toBe('Not saved');
    expect(el.querySelector<HTMLInputElement>('.title input')!.value).toBe('Mine');

    click(el, 'Save now');
    await flush(fixture);
    expect(status(el)).toBe('All changes saved');
    expect(api['update']).toHaveBeenCalledTimes(2);
  });

  it('is read-only when the workflow does not let this person edit', async () => {
    const { el } = await open('7', 'author', edit({ status: 'InReview', canEdit: false, transitions: ['Draft'] }));

    expect(el.querySelector<HTMLInputElement>('.title input')!.disabled).toBe(true);
    expect(status(el)).toBe('Read only');
    expect([...el.querySelector('.panel .actions')!.querySelectorAll('.btn')].map((b) => b.textContent?.trim())).toEqual(['Return to draft']);
    expect(el.textContent).not.toContain('Save now');
  });

  it('offers only the moves the server allows and does them, saving pending text first', async () => {
    const { fixture, el } = await open('7', 'editor', edit({ transitions: ['InReview', 'Scheduled', 'Published', 'Archived'] }));
    expect([...el.querySelector('.panel .actions')!.querySelectorAll('.btn')].map((b) => b.textContent?.trim())).toEqual(['Submit for review', 'Schedule…', 'Publish', 'Archive']);

    type(el, '.title input', 'Edited then published');
    click(el, 'Publish');
    await flush(fixture, 50);

    expect(api['update']).toHaveBeenCalledBefore(api['transition']);
    expect(api['transition']).toHaveBeenCalledWith(7, 'Published', 4, null);
    expect(el.querySelector('.status')?.textContent?.trim()).toBe('Published');
    expect(el.querySelector('.banner')?.textContent).toContain('Moved to published');
  });

  it('schedules for the chosen local time, sent as UTC', async () => {
    const { fixture, el } = await open('7', 'editor', edit({ transitions: ['Scheduled', 'Published'] }));

    click(el, 'Schedule…');
    fixture.detectChanges();
    const when = el.querySelector<HTMLInputElement>('input[type=datetime-local]')!;
    when.value = '2030-05-06T09:30';
    el.querySelector<HTMLFormElement>('form.schedule')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(fixture, 50);

    const [, status2, , scheduled] = api['transition'].mock.calls[0];
    expect(status2).toBe('Scheduled');
    expect(scheduled).toBe(new Date('2030-05-06T09:30').toISOString());
  });

  it('defaults the schedule to tomorrow on the hour', () => {
    expect(defaultScheduleValue(new Date(2026, 8, 20, 14, 45))).toBe('2026-09-21T14:00');
  });

  it('deletes a draft only after confirmation', async () => {
    const { fixture, el } = await open('7');
    const confirm = vi.spyOn(window, 'confirm');

    confirm.mockReturnValueOnce(false);
    click(el, 'Delete');
    await flush(fixture);
    expect(api['remove']).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    click(el, 'Delete');
    await flush(fixture);
    expect(api['remove']).toHaveBeenCalledWith(7);
    expect(navigate).toHaveBeenCalledWith(['/studio/articles']);
  });

  it('hides Delete for published items', async () => {
    const { el } = await open('7', 'editor', edit({ status: 'Published', transitions: ['Draft', 'Archived'] }));

    expect(el.textContent).not.toContain('Delete');
    expect(el.textContent).toContain('View on the site');
  });

  it('shows the history, previews an old version and restores it as the newest', async () => {
    const { fixture, el } = await open('7');

    click(el, 'History');
    await flush(fixture);
    expect([...el.querySelectorAll('.revs .link')].map((b) => b.textContent?.trim().slice(0, 9))).toEqual(['Version 2', 'Version 1']);

    (el.querySelectorAll<HTMLButtonElement>('.revs .link')[1]).click();
    await flush(fixture);
    expect(el.querySelector('.rev')?.textContent).toContain('Old body.');

    click(el, 'Restore this version');
    await flush(fixture);
    expect(api['restore']).toHaveBeenCalledWith(7, 1, 3);
    expect(el.querySelector<HTMLInputElement>('.title input')!.value).toBe('Older');
    expect(el.querySelector('.banner')?.textContent).toContain('Version 1 restored');
  });

  it('previews what the server kept, after saving', async () => {
    const { fixture, el } = await open('7');

    type(el, '.title input', 'Changed');
    click(el, 'Preview');
    await flush(fixture, 50);

    expect(api['update']).toHaveBeenCalled();
    expect(el.querySelector('.preview')?.textContent).toContain('Changed');
    expect(el.querySelector('app-rich-text')).toBeNull();
    click(el, 'Back to editing');
    await flush(fixture);
    expect(el.querySelector('app-rich-text')).not.toBeNull();
  });

  it('only accepts an approved picture as the main picture', async () => {
    const { fixture, el, page } = await open('7');

    click(el, 'Choose');
    await flush(fixture);
    const tiles = el.querySelectorAll<HTMLButtonElement>('.modal .tile__pick');
    tiles[1].click();                                   // the pending one
    await flush(fixture);
    expect(el.querySelector('.modal')?.textContent).toContain('Only an approved picture');
    expect(el.querySelector('.featured')).toBeNull();

    tiles[0].click();
    await flush(fixture, AUTOSAVE_MS + 100);
    expect(el.querySelector('.modal')).toBeNull();
    expect(el.querySelector('.featured')?.getAttribute('src')).toBe('/media/aa/one.jpg');
    expect(api['update'].mock.calls.at(-1)?.[1].featuredMediaId).toBe(1);
    expect(page['picker']).toBeDefined();
  });

  it('adds a new category (editors) and selects it', async () => {
    const { fixture, el } = await open('7');

    type(el, 'input[aria-label="New category name"]', 'New');
    el.querySelector<HTMLFormElement>('form.inline')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(fixture, AUTOSAVE_MS + 100);

    expect(api['createCategory']).toHaveBeenCalledWith('New');
    expect(api['update'].mock.calls.at(-1)?.[1].categoryId).toBe(2);
  });

  it('hides editor-only controls from authors', async () => {
    const { el } = await open('7', 'author');

    expect(el.textContent).not.toContain('Web address');
    expect(el.textContent).not.toContain('Feature on the home page');
    expect(el.querySelector('input[aria-label="New category name"]')).toBeNull();
  });
});

describe('MediaLibrary', () => {
  async function setup(role: 'author' | 'editor', picking = false) {
    TestBed.resetTestingModule();
    const api = {
      media: vi.fn(() => Promise.resolve({ items: [media({ id: 1 }), media({ id: 2, status: 'Pending', caption: null })], total: 2, page: 1, pageSize: 24 })),
      uploadMedia: vi.fn(() => Promise.resolve(media({ id: 3, status: role === 'editor' ? 'Approved' : 'Pending' }))),
      updateMedia: vi.fn((id: number, caption: string | null) => Promise.resolve(media({ id, caption }))),
      setMediaStatus: vi.fn((id: number, s: MediaView['status']) => Promise.resolve(media({ id, status: s }))),
    };
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: StudioApi, useValue: api }, { provide: AuthService, useValue: { hasRole: (r: string) => r === 'author' || role === 'editor' } }],
    });
    const fixture = TestBed.createComponent(MediaLibrary);
    fixture.componentRef.setInput('picking', picking);
    const picked: MediaView[] = [];
    fixture.componentInstance.picked.subscribe((m) => picked.push(m));
    const settle = async () => {
      await wait();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    return { fixture, api, picked, el: fixture.nativeElement as HTMLElement, settle };
  }

  it('shows thumbnails with their approval state', async () => {
    const { el } = await setup('editor');

    expect(el.querySelectorAll('.tile')).toHaveLength(2);
    expect([...el.querySelectorAll('.badge')].map((b) => b.textContent)).toEqual(['Approved', 'Waiting']);
    expect(el.querySelector('.tile img')?.getAttribute('src')).toBe('/media/aa/one-480.jpg');
  });

  it('opens details on click and lets an editor approve or reject', async () => {
    const { el, api, settle } = await setup('editor');

    el.querySelectorAll<HTMLButtonElement>('.tile__pick')[1].click();
    await settle();
    const buttons = [...el.querySelectorAll('.detail .btn')].map((b) => b.textContent?.trim());
    expect(buttons).toEqual(['Save details', 'Approve', 'Reject', 'Close']);

    [...el.querySelectorAll<HTMLButtonElement>('.detail .btn')].find((b) => b.textContent?.trim() === 'Approve')!.click();
    await settle();
    expect(api.setMediaStatus).toHaveBeenCalledWith(2, 'Approved');
    expect(el.querySelector('.badge[data-status=Approved]')).not.toBeNull();
  });

  it('gives authors no approval buttons and tells them a picture waits for approval', async () => {
    const { el, settle } = await setup('author');

    expect(el.textContent).toContain('checked by an editor');
    el.querySelector<HTMLButtonElement>('.tile__pick')!.click();
    await settle();
    expect([...el.querySelectorAll('.detail .btn')].map((b) => b.textContent?.trim())).toEqual(['Save details', 'Close']);
  });

  it('saves a new caption', async () => {
    const { el, api, settle } = await setup('editor');

    el.querySelector<HTMLButtonElement>('.tile__pick')!.click();
    await settle();
    el.querySelector<HTMLInputElement>('.detail input')!.value = 'New caption';
    el.querySelector<HTMLFormElement>('.detail form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(api.updateMedia).toHaveBeenCalledWith(1, 'New caption', null);
  });

  it('uploads a picture, refreshes the list and clears the form', async () => {
    const { el, api, settle } = await setup('author');
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    el.querySelector<HTMLInputElement>('input[maxlength="500"]')!.value = 'A patrol';

    el.querySelector<HTMLFormElement>('form.lib__upload')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(api.uploadMedia).toHaveBeenCalledWith(file, 'A patrol', '');
    expect(api.media).toHaveBeenCalledTimes(2);
    expect(el.querySelector<HTMLInputElement>('input[maxlength="500"]')!.value).toBe('');
  });

  it('shows the server\'s reason when an upload is refused', async () => {
    const { el, api, settle } = await setup('author');
    api.uploadMedia.mockRejectedValueOnce(problem(400, 'Upload a JPEG, PNG or WebP picture.'));
    Object.defineProperty(el.querySelector('input[type=file]')!, 'files', { value: [new File(['x'], 'a.svg')], configurable: true });

    el.querySelector<HTMLFormElement>('form.lib__upload')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(el.querySelector('.error')?.textContent).toContain('Upload a JPEG, PNG or WebP picture.');
  });

  it('when picking, choosing a picture hands it back instead of opening details', async () => {
    const { el, picked, settle } = await setup('author', true);

    el.querySelectorAll<HTMLButtonElement>('.tile__pick')[0].click();
    await settle();

    expect(picked.map((m) => m.id)).toEqual([1]);
    expect(el.querySelector('.detail')).toBeNull();
    expect(el.querySelector('h2')?.textContent).toBe('Choose a picture');
  });
});

describe('StudioFeedback', () => {
  it('lists messages with a reply link and lets an editor mark them done', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    const ctl = TestBed.inject(HttpTestingController);
    const { StudioFeedback } = await import('./studio-feedback');
    const fixture = TestBed.createComponent(StudioFeedback);
    fixture.detectChanges();
    const row = { id: 4, name: null, email: 'pat@example.com', message: 'The date is wrong.', createdUtc: '2026-03-01T00:00:00Z', handled: false };
    ctl.expectOne('/api/studio/feedback').flush([row]);
    await wait();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('Anonymous');
    expect(el.textContent).toContain('The date is wrong.');
    expect(el.querySelector('a')?.getAttribute('href')).toBe('mailto:pat@example.com');

    el.querySelector<HTMLButtonElement>('button')!.click();
    const req = ctl.expectOne('/api/studio/feedback/4/handled');
    expect(req.request.body).toEqual({ handled: true });
    req.flush({ ...row, handled: true });
    await wait();
    fixture.detectChanges();
    expect(el.querySelector('.item.is-done')).not.toBeNull();
    expect(el.textContent).toContain('Mark as not done');
  });
});

describe('StudioModeration', () => {
  const queue = {
    notes: [{ id: 1, contactId: 2, title: 'Ambush site', body: 'Claymores along the track.', authorName: 'Ann Member', updatedUtc: '2026-03-01T00:00:00Z', isChange: false }, { id: 2, contactId: 9, title: 'Changed', body: 'Better.', authorName: 'Bo Member', updatedUtc: '2026-03-02T00:00:00Z', isChange: true }],
    pictures: [{ incidentMediaId: 10, mediaId: 5, contactId: 2, url: '/media/aa/f.jpg', thumbUrl: '/media/aa/f-480.jpg', caption: 'A patrol', credit: 'AWM', uploadedByName: 'Ann Member' }],
    casualties: [{ id: 4, contactId: 2, serviceNumber: '5715978', casualtyType: 'Killed in action', comment: 'See the unit diary.', submittedByName: 'Ann Member', createdUtc: '2026-03-01T00:00:00Z', handled: false }],
  };

  async function open(load: () => Promise<unknown>) {
    TestBed.resetTestingModule();
    const api = {
      queue: vi.fn(load),
      moderateNote: vi.fn(() => Promise.resolve({})),
      setPictureStatus: vi.fn(() => Promise.resolve({})),
      markCasualty: vi.fn(() => Promise.resolve({})),
    };
    const { CommunityService } = await import('../battlemap/community/community');
    const { StudioModeration } = await import('./studio-moderation');
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: CommunityService, useValue: api }] });
    const fixture = TestBed.createComponent(StudioModeration);
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await wait();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    return { api, el, settle };
  }

  const buttons = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === label);

  it('lists what is waiting, oldest first, with a link to each incident', async () => {
    const { el } = await open(() => Promise.resolve(structuredClone(queue)));

    expect([...el.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Notes (2)', 'Pictures (1)', 'Casualty information (1)']);
    expect(el.textContent).toContain('A change to an approved note');
    expect(el.querySelector('article a[href="/battlemap?incident=2"]')).not.toBeNull();
    expect(el.querySelector('.pics img')?.getAttribute('src')).toBe('/media/aa/f-480.jpg');
    expect(el.textContent).toContain('Killed in action, service number 5715978');
  });

  it('shows a picture carried over from the old site without an incident link when it has no incident', async () => {
    const { el } = await open(() => Promise.resolve({ ...structuredClone(queue), pictures: [{ ...structuredClone(queue).pictures[0], contactId: null }] }));

    expect(el.querySelector('.pics img')).not.toBeNull();
    expect(el.querySelector('.pics a[href^="/battlemap?incident="]')).toBeNull();
    expect(el.querySelector('.pics')?.textContent).not.toContain('Incident');
  });

  it('approves or rejects a note and takes it off the list', async () => {
    const { api, el, settle } = await open(() => Promise.resolve(structuredClone(queue)));

    buttons(el, 'Approve')[0].click();
    await settle();
    buttons(el, 'Reject')[0].click();
    await settle();

    expect(api.moderateNote).toHaveBeenNthCalledWith(1, 1, 'Approved');
    expect(api.moderateNote).toHaveBeenNthCalledWith(2, 2, 'Rejected');
    expect(el.querySelector('h2')?.textContent).toBe('Pictures (1)');                         // both notes are gone
  });

  it('approves a picture through its file, and marks casualty information as dealt with', async () => {
    const { api, el, settle } = await open(() => Promise.resolve({ ...structuredClone(queue), notes: [] }));

    buttons(el, 'Approve')[0].click();
    await settle();
    buttons(el, 'Mark as dealt with')[0].click();
    await settle();

    expect(api.setPictureStatus).toHaveBeenCalledWith(5, 'Approved');
    expect(api.markCasualty).toHaveBeenCalledWith(4, true);
    expect(el.textContent).toContain('Nothing is waiting.');
  });

  it('keeps the item and says why when an action fails', async () => {
    const { api, el, settle } = await open(() => Promise.resolve(structuredClone(queue)));
    api.moderateNote.mockRejectedValueOnce(problem(403, 'Only editors can approve or reject notes.'));

    buttons(el, 'Approve')[0].click();
    await settle();

    expect(el.querySelector('[role=alert]')?.textContent).toContain('Only editors');
    expect(el.querySelector('h2')?.textContent).toBe('Notes (2)');
  });

  it('says so when the queue cannot be loaded', async () => {
    const { el } = await open(() => Promise.reject(new Error('down')));

    expect(el.querySelector('[role=alert]')?.textContent).toContain('could not be loaded');
  });
});
