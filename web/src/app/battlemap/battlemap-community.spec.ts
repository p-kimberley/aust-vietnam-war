import { vi } from 'vitest';
import { describe, expect, it } from 'vitest';
import { HonourPerson, HonourSummary } from './community/community';
import { render, settle } from './battlemap-testing';

type Rendered = Awaited<ReturnType<typeof render>>;

const summary: HonourSummary = { serviceNumber: '5715978', name: 'James Mungo White', rank: 'Private', branch: 'Army', birth: null, death: null, ageAtDeath: null, portraitUrl: null };
const person: HonourPerson = {
  ...summary,
  birthPlace: null,
  birthState: null,
  birthCountry: null,
  nationalService: null,
  tours: [],
  incidents: [2],
  tributes: 0,
};

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const tab = (r: Rendered, label: string) => [...r.el.querySelectorAll<HTMLButtonElement>('.incident__tab')].find((t) => text(t).startsWith(label))!;
const community = () => ({
  notes: vi.fn(() => Promise.resolve([{ id: 1 }, { id: 2 }, { id: 3 }])),
  media: vi.fn(() => Promise.resolve([{ id: 1 }])),
  casualties: vi.fn(() => Promise.resolve([summary])),
  person: vi.fn(() => Promise.resolve(person)),
});

describe('Battle Map incident tabs', () => {
  it('shows Details first, with the number of notes, pictures and people on the other tabs', async () => {
    const r = await render({ inputs: { incident: '2' }, community: community() });
    await settle(r.fixture);

    expect([...r.el.querySelectorAll('.incident__tab')].map((t) => text(t))).toEqual(['Details', 'Notes 3', 'Pictures 1', 'Honour roll 1']);
    expect(tab(r, 'Details').getAttribute('aria-selected')).toBe('true');
    const panels = [...r.el.querySelectorAll<HTMLElement>('.incident__body > div')];
    expect(panels.map((p) => p.hidden)).toEqual([false, true, true, true]);
  });

  it('switches between the tabs, showing one at a time', async () => {
    const r = await render({ inputs: { incident: '2' }, community: community() });
    await settle(r.fixture);

    tab(r, 'Notes').click();
    await settle(r.fixture);

    expect(tab(r, 'Notes').getAttribute('aria-selected')).toBe('true');
    expect([...r.el.querySelectorAll<HTMLElement>('.incident__body > div')].map((p) => p.hidden)).toEqual([true, false, true, true]);
  });

  it('goes back to Details and to fresh counts when another incident is opened', async () => {
    const r = await render({ inputs: { incident: '2' }, community: community() });
    await settle(r.fixture);
    tab(r, 'Notes').click();
    await settle(r.fixture);

    (r.fixture.componentInstance as unknown as { select(id: number): void }).select(9);
    await settle(r.fixture);

    expect(tab(r, 'Details').getAttribute('aria-selected')).toBe('true');
    expect(r.community['notes']).toHaveBeenLastCalledWith(9);
  });
});

describe('Battle Map honour roll', () => {
  it('opens a person from an incident, replacing the incident panel, and back to an incident from the person', async () => {
    const r = await render({ inputs: { incident: '2' }, community: community() });
    await settle(r.fixture);

    tab(r, 'Honour roll').click();
    await settle(r.fixture);
    r.el.querySelector<HTMLButtonElement>('.people button')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-incident-panel')).toBeNull();
    expect(text(r.el.querySelector('app-honour-panel h2'))).toBe('James Mungo White');
    expect(r.community['person']).toHaveBeenCalledWith('5715978');

    [...r.el.querySelectorAll<HTMLButtonElement>('app-honour-panel button')].find((b) => text(b) === 'Incident 2')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-honour-panel')).toBeNull();
    expect(r.el.querySelector('app-incident-panel')).not.toBeNull();
    expect(r.basemaps.flyTo).toHaveBeenCalled();
  });

  it('opens straight onto a person from a shared link, unless the link names an incident', async () => {
    const onlyPerson = await render({ inputs: { person: '5715978' }, community: community() });
    await settle(onlyPerson.fixture);
    expect(onlyPerson.el.querySelector('app-honour-panel')).not.toBeNull();
    expect(onlyPerson.el.querySelector('app-incident-panel')).toBeNull();
  });

  it('closes the person panel from its close button', async () => {
    const r = await render({ inputs: { person: '5715978' }, community: community() });
    await settle(r.fixture);

    r.el.querySelector<HTMLButtonElement>('app-honour-panel .close')!.click();
    await settle(r.fixture);

    expect(r.el.querySelector('app-honour-panel')).toBeNull();
  });

  it('closes the person panel when an incident or a base is chosen instead', async () => {
    const r = await render({ inputs: { person: '5715978' }, community: community() });
    await settle(r.fixture);

    r.basemaps.clickHandler?.({ id: 1 });
    await settle(r.fixture);

    expect(r.el.querySelector('app-honour-panel')).toBeNull();
  });
});
