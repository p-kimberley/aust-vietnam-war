import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { render, settle } from './battlemap-testing';
import { CONTACTS } from './filter-fixtures';

type Rendered = Awaited<ReturnType<typeof render>>;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();
const tab = (r: Rendered, id: string) => r.el.querySelector<HTMLButtonElement>(`#left-tab-${id}`)!;
const flyout = (r: Rendered) => r.el.querySelector('#left-flyout')!;
const press = async (r: Rendered, id: string) => {
  tab(r, id).click();
  await settle(r.fixture);
};

describe('the tabs and fly-out at the left', () => {
  it('has a vertical tab for each tool at the top left, and nothing flown out to begin with', async () => {
    const r = await render({ contacts: CONTACTS });

    expect([...r.el.querySelectorAll('.bm__tabs [role=tab]')].map(text)).toEqual(['Charts', 'Nominal roll', 'Images']);
    expect(r.el.querySelector('.bm__tabs [role=tablist]')!.getAttribute('aria-orientation')).toBe('vertical');
    expect(flyout(r).classList.contains('is-open')).toBe(false);
    expect(flyout(r).getAttribute('role')).toBe('tabpanel');
    expect(r.el.querySelector('app-analytics-panel')).toBeNull();
    expect(r.el.querySelector('app-nominal-roll')).toBeNull();
  });

  it('is not there while the map is loading', async () => {
    const r = await render({ config: new Error('down') });

    expect(r.el.querySelector('.bm__tabs')).toBeNull();
    expect(r.el.querySelector('#left-flyout')).toBeNull();
  });

  it('flies a tool out when its tab is pressed, and names the panel by the tab', async () => {
    const r = await render({ contacts: CONTACTS });

    await press(r, 'charts');

    expect(flyout(r).classList.contains('is-open')).toBe(true);
    expect(flyout(r).getAttribute('aria-labelledby')).toBe('left-tab-charts');
    expect(tab(r, 'charts').getAttribute('aria-selected')).toBe('true');
    expect(r.el.querySelector('app-analytics-panel')).not.toBeNull();
  });

  it('swaps the tool when another tab is pressed, keeping the fly-out out', async () => {
    const r = await render({ contacts: CONTACTS });
    await press(r, 'charts');

    await press(r, 'roll');

    expect(flyout(r).classList.contains('is-open')).toBe(true);
    expect(r.el.querySelector('app-analytics-panel')).toBeNull();
    expect(r.el.querySelector('app-nominal-roll')).not.toBeNull();
    expect(tab(r, 'charts').getAttribute('aria-selected')).toBe('false');
    expect(tab(r, 'roll').getAttribute('aria-selected')).toBe('true');
    expect(flyout(r).classList.contains('bm__flyout--roll')).toBe(true);
  });

  it('puts the tool away when its tab is pressed again, after it has slid out of sight', async () => {
    const r = await render({ contacts: CONTACTS });
    await press(r, 'roll');

    await press(r, 'roll');
    expect(flyout(r).classList.contains('is-open')).toBe(false);
    expect(r.el.querySelector('app-nominal-roll')).not.toBeNull();             // still there while it slides

    await wait(350);
    await settle(r.fixture);
    expect(r.el.querySelector('app-nominal-roll')).toBeNull();
  });

  it('keeps the tool if it is opened again before it has gone', async () => {
    const r = await render({ contacts: CONTACTS });
    await press(r, 'charts');
    await press(r, 'charts');

    await press(r, 'charts');
    await wait(350);
    await settle(r.fixture);

    expect(flyout(r).classList.contains('is-open')).toBe(true);
    expect(r.el.querySelector('app-analytics-panel')).not.toBeNull();
  });

  it('is put away by Escape', async () => {
    const r = await render({ contacts: CONTACTS });
    await press(r, 'charts');

    flyout(r).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(r.fixture);

    expect(flyout(r).classList.contains('is-open')).toBe(false);
    expect(tab(r, 'charts').getAttribute('aria-selected')).toBe('false');
  });

  it('is put away by the close button of the tool', async () => {
    const r = await render({ contacts: CONTACTS });
    await press(r, 'roll');
    await settle(r.fixture);

    r.el.querySelector<HTMLButtonElement>('app-nominal-roll .close')!.click();
    await settle(r.fixture);

    expect(flyout(r).classList.contains('is-open')).toBe(false);
  });
});

describe('the fly-out and the link', () => {
  it('opens on the charts from an older link with charts=1', async () => {
    const r = await render({ contacts: CONTACTS, inputs: { charts: '1' } });

    expect(flyout(r).classList.contains('is-open')).toBe(true);
    expect(r.el.querySelector('app-analytics-panel')).not.toBeNull();
    expect(tab(r, 'charts').getAttribute('aria-selected')).toBe('true');
  });

  it('opens on the nominal roll from roll=1', async () => {
    const r = await render({ contacts: CONTACTS, inputs: { roll: '1' } });

    expect(flyout(r).classList.contains('is-open')).toBe(true);
    expect(r.el.querySelector('app-nominal-roll')).not.toBeNull();
    expect(tab(r, 'roll').getAttribute('aria-selected')).toBe('true');
  });

  it('writes the open tool into the link, and takes it out when it is put away', async () => {
    const r = await render({ contacts: CONTACTS });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const params = () => navigate.mock.calls.at(-1)![1]!.queryParams!;

    await press(r, 'roll');
    await wait(450);
    expect(params()).toMatchObject({ roll: '1', charts: null });

    await press(r, 'charts');
    await wait(450);
    expect(params()).toMatchObject({ roll: null, charts: '1' });

    await press(r, 'charts');
    await wait(450);
    expect(params()).toMatchObject({ roll: null, charts: null });
  });
});
