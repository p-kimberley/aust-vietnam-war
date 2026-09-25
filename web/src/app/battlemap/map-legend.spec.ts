import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { render, settle } from './battlemap-testing';
import { MapLegend } from './map-legend';

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();

function setup(inputs: Record<string, unknown> = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const f = TestBed.createComponent(MapLegend);
  for (const [k, v] of Object.entries(inputs)) {
    f.componentRef.setInput(k, v);
  }
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const entries = () => [...el.querySelectorAll('.legend__list li')].map(text);
  const toggle = () => el.querySelector<HTMLButtonElement>('.legend__toggle')!;
  const frame = () => el.querySelector('.legend__frame')!;
  return { f, el, entries, toggle, frame };
}

describe('MapLegend', () => {
  it('is open to begin with, and the button shuts it and opens it again', () => {
    const { f, toggle, frame } = setup();

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe('legend-body');
    expect(frame().classList.contains('is-open')).toBe(true);

    toggle().click();
    f.detectChanges();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(frame().classList.contains('is-open')).toBe(false);

    toggle().click();
    f.detectChanges();
    expect(frame().classList.contains('is-open')).toBe(true);
  });

  it('explains the contact markers and the ring round the open incident', () => {
    const { entries } = setup({ showHeatmap: false });

    expect(entries()).toEqual(['Contact']);
  });

  it('says what larger markers mean, only when the size is chosen by something', () => {
    const plain = setup({ showHeatmap: false });
    expect(plain.entries().some((e) => e?.startsWith('Larger for more'))).toBe(false);

    const sized = setup({ showHeatmap: false, sizeField: 'Enemy force killed' });
    expect(sized.entries()).toContain('Larger for more: enemy force killed');
  });

  it('shows the heatmap scale, and what it is of, only while the heatmap is on', () => {
    const on = setup({ showContacts: false, showHeatmap: true, heatField: 'Size of friendly force' });
    expect(text(on.el.querySelector('.legend__label'))).toBe('Heatmap: size of friendly force');
    expect(text(on.el.querySelector('.legend__ends'))).toBe('FewerMore');
    expect(on.el.querySelector('.legend__ramp')).not.toBeNull();

    const off = setup({ showContacts: false, showHeatmap: false });
    expect(off.el.querySelector('.legend__ramp')).toBeNull();
  });

  it('lists each type of point on the map once, in a fixed order, by its full name', () => {
    const { entries } = setup({ showContacts: false, showHeatmap: false, poiTypes: ['Other', 'LZ', 'FSB', 'FSB', 'Base', 'FSPB'] });

    expect(entries()).toEqual(['Fire Support Base', 'Fire Support Patrol Base', 'Landing Zone', 'Base', 'Other']);
  });

  it('draws the map own icon for each type of point where a canvas is available', () => {
    vi.stubGlobal('Path2D', class { constructor(_p?: string) {} rect() {} arc() {} });
    const ctx = new Proxy({}, { get: () => vi.fn(), set: () => true });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
    try {
      const { el } = setup({ showContacts: false, showHeatmap: false, poiTypes: ['FSB', 'LZ'] });

      expect([...el.querySelectorAll('.legend__list img')].map((i) => i.getAttribute('src'))).toEqual(['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA']);
      expect(el.querySelectorAll('.legend__blank')).toHaveLength(0);
    } finally {
      getContext.mockRestore();
      toDataURL.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('keeps the entry, with a blank where the picture would be, when there is no canvas', () => {
    // A type no other test draws, since a picture that has been drawn once is kept.
    const { el, entries } = setup({ showContacts: false, showHeatmap: false, poiTypes: ['Base'] });

    expect(entries()).toEqual(['Base']);
    expect(el.querySelector('.legend__blank')).not.toBeNull();
  });

  it('shows the photo symbols only when photos are on the map, and the path only while a unit is followed', () => {
    const none = setup({ showContacts: false, showHeatmap: false });
    expect(none.entries()).toEqual(['Nothing is switched on.']);

    const both = setup({ showContacts: false, showHeatmap: false, showPhotos: true, following: true });
    expect(both.entries()).toEqual(['Community photo', 'Path of a followed unit']);
  });
});

describe('the legend on the Battle Map', () => {
  const legend = (r: Awaited<ReturnType<typeof render>>) => r.el.querySelector('.bm__legend');
  const column = (r: Awaited<ReturnType<typeof render>>) => r.el.querySelector('.bm__right')!;
  const entries = (r: Awaited<ReturnType<typeof render>>) => [...r.el.querySelectorAll('.legend__list li')].map(text);

  it('sits on the map once it is ready, listing what is showing', async () => {
    const r = await render({});

    expect(legend(r)).not.toBeNull();
    expect(entries(r)).toEqual(expect.arrayContaining(['Contact', 'Fire Support Base', 'Landing Zone']));
    expect(entries(r).some((e) => e?.startsWith('Heatmap:'))).toBe(true);
  });

  it('is not there while the map is loading, or when it failed', async () => {
    const r = await render({ config: new Error('down') });

    expect(legend(r)).toBeNull();
  });

  it('follows the layers: a layer switched off loses its entries', async () => {
    const r = await render({});
    const box = (label: string) => [...r.el.querySelectorAll<HTMLLabelElement>('#tabpanel label')].find((l) => l.textContent?.includes(label))!.querySelector('input')!;

    box('Bases and landing zones').click();
    box('Heatmap').click();
    box('Incident markers').click();
    await settle(r.fixture);

    expect(entries(r)).toEqual(['Nothing is switched on.']);
  });

  it('names the heatmap field and the marker size as they are chosen', async () => {
    const r = await render({ inputs: { field: 'enCas', size: 'frWia' } });

    expect(text(r.el.querySelector('.legend__label'))).toBe('Heatmap: enemy casualties');
    expect(entries(r)).toContain('Larger for more: friendly force wounded');
  });

  it('moves aside for an incident, so it is not hidden behind the panel', async () => {
    const r = await render({});
    expect(column(r).classList.contains('bm__right--shifted')).toBe(false);

    r.basemaps.clickHandler!({ id: 9 });
    await settle(r.fixture);

    expect(column(r).classList.contains('bm__right--shifted')).toBe(true);
  });
});
