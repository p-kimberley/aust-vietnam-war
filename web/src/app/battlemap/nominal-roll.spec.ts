import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { render, settle } from './battlemap-testing';
import type { HonourFacets, HonourPage, HonourPerson, HonourSummary } from './community/community';
import { communityProviders, fakeAuth, fakeCommunity } from './community/community-testing';
import { NominalRoll, ROLL_DELAY_MS, ROLL_PAGE_SIZE } from './nominal-roll';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();

const summary = (n: number, over: Partial<HonourSummary> = {}): HonourSummary => ({
  serviceNumber: `57${n}`,
  name: `Person ${n}`,
  rank: 'Private',
  branch: 'Infantry',
  birth: '1945-03-02',
  death: '1966-08-18',
  ageAtDeath: 21,
  portraitUrl: null,
  ...over,
});

const WHITE: HonourPerson = {
  ...summary(1, { serviceNumber: '5715978', name: 'James Mungo White', portraitUrl: '/media/portraits/5715978.jpg' }),
  birthPlace: 'Ballarat',
  birthState: 'VIC',
  birthCountry: 'Australia',
  nationalService: true,
  tours: [{ unit: '6 RAR', start: '1966-05-25', end: '1966-08-18' }],
  incidents: [2, 9],
  tributes: 3,
};

const NONE = { service: '', rank: '', corps: '' };

const FACETS: HonourFacets = {
  services: [
    { value: 'Army', count: 3 },
    { value: 'Navy', count: 1 },
  ],
  ranks: [
    { value: 'Private', count: 2 },
    { value: 'Sapper', count: 1 },
  ],
  corps: [{ value: 'Royal Australian Engineers', count: 1 }],
};

const page = (items: HonourSummary[], total = items.length, n = 1): HonourPage => ({ items, total, page: n, pageSize: ROLL_PAGE_SIZE });

function roll(over: Record<string, unknown> = {}) {
  TestBed.resetTestingModule();
  const community = fakeCommunity({ honourRoll: vi.fn(() => Promise.resolve(page([summary(1), summary(2)]))), person: vi.fn(() => Promise.resolve(WHITE)), ...over });
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...communityProviders(community, fakeAuth())] });
  const fixture: ComponentFixture<NominalRoll> = TestBed.createComponent(NominalRoll);
  const closed = vi.fn();
  const incidents = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.componentInstance.openIncident.subscribe(incidents);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const settleRoll = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const rows = () => [...el.querySelectorAll<HTMLButtonElement>('.person')];
  const input = () => el.querySelector<HTMLInputElement>('.find__input')!;
  const typeIn = async (value: string) => {
    input().value = value;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await wait(ROLL_DELAY_MS + 40);
    await settleRoll();
  };
  return { fixture, el, community, closed, incidents, settleRoll, rows, input, typeIn };
}

describe('NominalRoll', () => {
  it('starts as the whole roll: the first page, with who each person was at a glance', async () => {
    const { community, settleRoll, rows, el } = roll();
    await settleRoll();

    expect(community['honourRoll']).toHaveBeenCalledWith('', 1, ROLL_PAGE_SIZE, NONE, true);
    expect(rows().map((r) => text(r.querySelector('.person__name')))).toEqual(['Person 1', 'Person 2']);
    expect(text(rows()[0].querySelector('.person__meta'))).toBe('Private · Infantry · died 1966');
    expect(text(el.querySelector('.count'))).toBe('2 people');
    expect(el.querySelector('h2')!.textContent).toContain('Nominal roll');
  });

  it('has a labelled search box for a name or service number', async () => {
    const { settleRoll, input } = roll();
    await settleRoll();

    expect(input().type).toBe('search');
    expect(input().getAttribute('aria-label')).toBe('Search the nominal roll by name or service number');
    expect(input().getAttribute('placeholder')).toBe('Search by name or service number');
  });

  it('shows a small portrait beside those who have one, and a blank mount for those who do not', async () => {
    const { settleRoll, rows } = roll({ honourRoll: vi.fn(() => Promise.resolve(page([summary(1, { portraitUrl: '/media/portraits/1.jpg' }), summary(2)]))) });
    await settleRoll();

    expect(rows()[0].querySelector('img')!.getAttribute('src')).toBe('/media/portraits/1.jpg');
    expect(rows()[0].querySelector('img')!.getAttribute('alt')).toBe('');
    expect(rows()[1].querySelector('img')).toBeNull();
    expect(rows()[1].querySelector('.person__portrait--none')).not.toBeNull();
  });

  it('searches when typing pauses, and lists just those who match', async () => {
    const honourRoll = vi.fn((q: string) => Promise.resolve(q === 'white' ? page([summary(9, { name: 'James Mungo White' })]) : page([summary(1), summary(2)])));
    const { community, settleRoll, rows, typeIn } = roll({ honourRoll });
    await settleRoll();

    await typeIn('white');

    expect(community['honourRoll']).toHaveBeenLastCalledWith('white', 1, ROLL_PAGE_SIZE, NONE, true);
    expect(rows().map((r) => text(r.querySelector('.person__name')))).toEqual(['James Mungo White']);
  });

  it('does not search on every key, only when typing pauses', async () => {
    const { community, settleRoll, input, fixture } = roll();
    await settleRoll();
    community['honourRoll'].mockClear();

    for (const value of ['w', 'wh', 'whi']) {
      input().value = value;
      input().dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
    }
    await wait(ROLL_DELAY_MS + 40);
    await settleRoll();

    expect(community['honourRoll']).toHaveBeenCalledTimes(1);
    expect(community['honourRoll']).toHaveBeenCalledWith('whi', 1, ROLL_PAGE_SIZE, NONE, true);
  });

  it('says when nobody matches', async () => {
    const { el, settleRoll, typeIn } = roll({ honourRoll: vi.fn((q: string) => Promise.resolve(q ? page([]) : page([summary(1)]))) });
    await settleRoll();

    await typeIn('zzz');

    expect(text(el.querySelector('.count'))).toBe('Nobody matches.');
    expect(el.querySelectorAll('.person')).toHaveLength(0);
  });

  it('ignores the answer to an older search that arrives late', async () => {
    let releaseSlow!: (p: HonourPage) => void;
    const honourRoll = vi.fn((q: string) => (q === 'slow' ? new Promise<HonourPage>((r) => (releaseSlow = r)) : Promise.resolve(page([summary(5, { name: 'Fast' })]))));
    const { settleRoll, rows, typeIn } = roll({ honourRoll });
    await settleRoll();

    await typeIn('slow');                                         // asked, and not yet answered
    await typeIn('fast');
    releaseSlow(page([summary(6, { name: 'Slow' })]));
    await settleRoll();

    expect(rows().map((r) => text(r.querySelector('.person__name')))).toEqual(['Fast']);
  });

  it('offers more when there are more, and adds the next page to the list', async () => {
    const honourRoll = vi.fn((_q: string, n: number) => Promise.resolve(page(n === 1 ? [summary(1), summary(2)] : [summary(3)], 3, n)));
    const { community, el, settleRoll, rows, fixture } = roll({ honourRoll });
    await settleRoll();
    expect(text(el.querySelector('.count'))).toBe('Showing 2 of 3 people');

    el.querySelector<HTMLButtonElement>('.more')!.click();
    fixture.detectChanges();
    await settleRoll();

    expect(community['honourRoll']).toHaveBeenLastCalledWith('', 2, ROLL_PAGE_SIZE, NONE, false);          // a further page does not ask for the drop-down choices again
    expect(rows()).toHaveLength(3);
    expect(text(el.querySelector('.count'))).toBe('3 people');
    expect(el.querySelector('.more')).toBeNull();
  });

  it('writes each name as a roll does, surname first, and falls back to the plain name', async () => {
    const { settleRoll, rows } = roll({
      honourRoll: vi.fn(() => Promise.resolve(page([summary(1, { name: 'James Mungo White', sortName: 'White, James Mungo' }), summary(2, { name: 'Robert Grist' })]))),
    });
    await settleRoll();

    expect(rows().map((r) => text(r.querySelector('.person__name')))).toEqual(['White, James Mungo', 'Robert Grist']);
  });

  describe('filters', () => {
    const withFacets = () => roll({ honourRoll: vi.fn(() => Promise.resolve({ ...page([summary(1), summary(2)]), facets: FACETS })) });
    const selects = (el: HTMLElement) => [...el.querySelectorAll<HTMLSelectElement>('select.filter')];
    const choose = async (r: ReturnType<typeof roll>, index: number, value: string) => {
      const select = selects(r.el)[index];
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      r.fixture.detectChanges();
      await r.settleRoll();
    };

    it('offers the service, rank and corps that there are, each with how many, and all of them first', async () => {
      const r = withFacets();
      await r.settleRoll();

      expect(selects(r.el).map((s) => s.getAttribute('aria-label'))).toEqual(['Service', 'Rank', 'Corps']);
      expect([...selects(r.el)[0].options].map((o) => text(o))).toEqual(['All services', 'Army (3)', 'Navy (1)']);
      expect([...selects(r.el)[1].options].map((o) => text(o))).toEqual(['All ranks', 'Private (2)', 'Sapper (1)']);
      expect([...selects(r.el)[2].options].map((o) => text(o))).toEqual(['All corps', 'Royal Australian Engineers (1)']);
      expect(selects(r.el).map((s) => s.value)).toEqual(['', '', '']);
      expect(r.el.querySelector('.clear')).toBeNull();
    });

    it('lists the roll again from the first page with what was chosen, and keeps the search', async () => {
      const r = withFacets();
      await r.settleRoll();
      await r.typeIn('white');

      await choose(r, 0, 'Navy');

      expect(r.community['honourRoll']).toHaveBeenLastCalledWith('white', 1, ROLL_PAGE_SIZE, { ...NONE, service: 'Navy' }, true);
      expect(selects(r.el)[0].value).toBe('Navy');
    });

    it('combines a service, a rank and a corps, and shows a way to clear them', async () => {
      const r = withFacets();
      await r.settleRoll();

      await choose(r, 0, 'Army');
      await choose(r, 1, 'Sapper');
      await choose(r, 2, 'Royal Australian Engineers');

      expect(r.community['honourRoll']).toHaveBeenLastCalledWith('', 1, ROLL_PAGE_SIZE, { service: 'Army', rank: 'Sapper', corps: 'Royal Australian Engineers' }, true);
      expect(text(r.el.querySelector('.clear'))).toBe('Clear filters');
    });

    it('goes back to the whole roll when the filters are cleared, or one is set back to all', async () => {
      const r = withFacets();
      await r.settleRoll();
      await choose(r, 0, 'Army');
      await choose(r, 1, 'Private');

      await choose(r, 1, '');
      expect(r.community['honourRoll']).toHaveBeenLastCalledWith('', 1, ROLL_PAGE_SIZE, { ...NONE, service: 'Army' }, true);

      r.el.querySelector<HTMLButtonElement>('.clear')!.click();
      r.fixture.detectChanges();
      await r.settleRoll();

      expect(r.community['honourRoll']).toHaveBeenLastCalledWith('', 1, ROLL_PAGE_SIZE, NONE, true);
      expect(selects(r.el).map((s) => s.value)).toEqual(['', '', '']);
      expect(r.el.querySelector('.clear')).toBeNull();
    });

    it('takes the choices from the newest answer, so they narrow as the roll does', async () => {
      const navy: HonourFacets = { services: FACETS.services, ranks: [{ value: 'Petty Officer', count: 1 }], corps: [{ value: 'Seaman', count: 1 }] };
      const honourRoll = vi.fn((_q: string, _n: number, _size: number, chosen: { service: string }) =>
        Promise.resolve({ ...page([summary(1)]), facets: chosen.service === 'Navy' ? navy : FACETS }),
      );
      const r = roll({ honourRoll });
      await r.settleRoll();

      await choose(r, 0, 'Navy');

      expect([...selects(r.el)[1].options].map((o) => text(o))).toEqual(['All ranks', 'Petty Officer (1)']);
      expect([...selects(r.el)[2].options].map((o) => text(o))).toEqual(['All corps', 'Seaman (1)']);
      expect(selects(r.el)[0].value).toBe('Navy');
    });

    it('shows no lists of choices until the roll has said what there is, and does not fail without them', async () => {
      const r = roll();
      await r.settleRoll();

      expect(selects(r.el)).toHaveLength(3);
      expect(selects(r.el).map((s) => s.options.length)).toEqual([1, 1, 1]);
    });
  });

  it('says so when the roll cannot be searched, and tries again on request', async () => {
    let fail = true;
    const honourRoll = vi.fn(() => (fail ? Promise.reject(new Error('down')) : Promise.resolve(page([summary(1)]))));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { el, settleRoll, rows, fixture } = roll({ honourRoll });
    await settleRoll();
    expect(text(el.querySelector('[role=alert]'))).toContain('could not be searched');

    fail = false;
    el.querySelector<HTMLButtonElement>('.more')!.click();
    fixture.detectChanges();
    await settleRoll();

    expect(el.querySelector('[role=alert]')).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('tells its owner when it is closed', async () => {
    const { el, closed, settleRoll } = roll();
    await settleRoll();

    el.querySelector<HTMLButtonElement>('.close')!.click();

    expect(closed).toHaveBeenCalledTimes(1);
  });

  describe('a person chosen', () => {
    async function choose() {
      const r = roll();
      await r.settleRoll();
      r.rows()[0].click();
      r.fixture.detectChanges();
      await r.settleRoll();
      return r;
    }

    it('is shown with their portrait and details, in place of the list', async () => {
      const { community, el } = await choose();

      expect(community['person']).toHaveBeenCalledWith('571');
      expect(el.querySelector('.roll')).toBeNull();
      expect(el.querySelector('app-honour-panel')).not.toBeNull();
      expect(el.querySelector('h2')!.textContent).toContain('James Mungo White');
      expect(el.querySelector('img.portrait')!.getAttribute('src')).toBe('/media/portraits/5715978.jpg');
      expect(el.querySelector('img.portrait')!.getAttribute('alt')).toBe('Portrait of James Mungo White');
      expect(text(el)).toContain('Ballarat');
      expect(text(el)).toContain('6 RAR');
    });

    it('goes back to the list, as it was, with the arrow at the top', async () => {
      const { el, fixture, rows, typeIn, settleRoll } = roll({ honourRoll: vi.fn((q: string) => Promise.resolve(q ? page([summary(9, { name: 'Found' })]) : page([summary(1)]))) });
      await settleRoll();
      await typeIn('fou');
      rows()[0].click();
      fixture.detectChanges();
      await settleRoll();

      [...el.querySelectorAll('button')].find((b) => text(b)?.includes('Back to the roll'))!.click();
      fixture.detectChanges();

      expect(el.querySelector('app-honour-panel')).toBeNull();
      expect(el.querySelector<HTMLInputElement>('.find__input')!.value).toBe('fou');
      expect(rows().map((r) => text(r.querySelector('.person__name')))).toEqual(['Found']);
    });

    it('also goes back with the close button of the person', async () => {
      const { el, fixture } = await choose();

      el.querySelector<HTMLButtonElement>('app-honour-panel .close')!.click();
      fixture.detectChanges();

      expect(el.querySelector('.roll')).not.toBeNull();
    });

    it('opens an incident the person is linked to, on the map', async () => {
      const { el, incidents } = await choose();

      [...el.querySelectorAll<HTMLButtonElement>('app-honour-panel .link')].find((b) => text(b) === 'Incident 9')!.click();

      expect(incidents).toHaveBeenCalledExactlyOnceWith(9);
    });
  });
});

describe('the nominal roll in the Battle Map fly-out', () => {
  const community = () => ({
    honourRoll: vi.fn(() => Promise.resolve(page([summary(1, { name: 'Alan Smith' }), summary(2, { name: 'Bill Jones' })]))),
    person: vi.fn(() => Promise.resolve(WHITE)),
  });

  it('is the second tab, and flies out the roll when it is pressed', async () => {
    const r = await render({ community: community() });
    const tabs = [...r.el.querySelectorAll('.bm__tabs [role=tab]')].map((t) => text(t));
    expect(tabs).toEqual(['Charts', 'Nominal roll', 'Pictures']);
    expect(r.el.querySelector('app-nominal-roll')).toBeNull();

    r.el.querySelector<HTMLButtonElement>('#left-tab-roll')!.click();
    await settle(r.fixture);
    await wait(30);
    await settle(r.fixture);

    expect(r.el.querySelector('app-nominal-roll')).not.toBeNull();
    expect(r.el.querySelector('#left-flyout')!.classList.contains('is-open')).toBe(true);
    expect(r.el.querySelector('#left-flyout')!.classList.contains('bm__flyout--roll')).toBe(true);
    expect([...r.el.querySelectorAll('app-nominal-roll .person')].map((p) => text(p.querySelector('.person__name')))).toEqual(['Alan Smith', 'Bill Jones']);
  });

  it('shows a person in the fly-out, not in the panel at the right', async () => {
    const r = await render({ community: community() });
    r.el.querySelector<HTMLButtonElement>('#left-tab-roll')!.click();
    await settle(r.fixture);
    await wait(30);
    await settle(r.fixture);

    r.el.querySelector<HTMLButtonElement>('app-nominal-roll .person')!.click();
    await settle(r.fixture);
    await wait(30);
    await settle(r.fixture);

    expect(r.el.querySelector('#left-flyout app-honour-panel')).not.toBeNull();
    expect(r.el.querySelector('.bm__incident')).toBeNull();
  });

  it('opens an incident on the map from a person, leaving the roll where it is', async () => {
    const r = await render({ community: community() });
    r.el.querySelector<HTMLButtonElement>('#left-tab-roll')!.click();
    await settle(r.fixture);
    await wait(30);
    await settle(r.fixture);
    r.el.querySelector<HTMLButtonElement>('app-nominal-roll .person')!.click();
    await settle(r.fixture);
    await wait(30);
    await settle(r.fixture);

    [...r.el.querySelectorAll<HTMLButtonElement>('app-honour-panel .link')].find((b) => text(b) === 'Incident 2')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('.bm__incident app-incident-panel')).not.toBeNull();
    expect(r.el.querySelector('#left-flyout app-honour-panel')).not.toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalled();
  });
});
