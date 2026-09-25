import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHART, CHARTS } from '../battlemap-testing';
import { NARROW_SCREEN } from '../stored-flag';
import {
  AnalyticsService,
  ChartInfo,
  ChartResult,
  DARK,
  chartOption,
  chartTable,
  formatX,
  isEmpty,
  seriesColour,
} from './analytics';
import { AnalyticsPanel, REFRESH_DELAY_MS } from './analytics-panel';
import { StubEChart, stubEchartIn } from './echart-stub';

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

const chart = (over: Partial<ChartResult> = {}): ChartResult => ({ ...CHART, ...over });

describe('chartOption', () => {
  it('draws an area chart on a time axis with a zoom slider, and fixed colours for friendly and enemy', () => {
    const c = chart({ series: [{ name: 'Enemy killed', points: [[utc(1966, 8, 18), 3]] }, { name: 'Friendly killed', points: [[utc(1966, 8, 18), 17]] }] });

    const o = chartOption(c) as Record<string, any>;

    expect(o['xAxis'].type).toBe('time');
    expect(o['color']).toEqual([DARK.named['Enemy killed'], DARK.named['Friendly killed']]);
    expect(o['series'].map((s: any) => [s.name, s.type, !!s.areaStyle, s.stack])).toEqual([['Enemy killed', 'line', true, undefined], ['Friendly killed', 'line', true, undefined]]);
    expect(o['series'][0].data).toEqual([[utc(1966, 8, 18), 3]]);
    expect(o['dataZoom'].map((z: any) => z.type)).toEqual(['inside', 'slider']);
    expect(o['aria'].enabled).toBe(true);
  });

  it('leaves the zoom slider off when asked (on a phone), still zooming by dragging or pinching, and gives its room to the chart', () => {
    const o = chartOption(chart(), DARK, { slider: false }) as Record<string, any>;

    expect(o['dataZoom'].map((z: any) => z.type)).toEqual(['inside']);
    expect(o['grid'].bottom).toBe(28);
  });

  it('stacks stacked charts, and draws bars for bar charts', () => {
    const stackedArea = chartOption(chart({ shape: 'StackedArea' })) as Record<string, any>;
    const stackedBar = chartOption(chart({ shape: 'StackedBar', x: 'Category', categories: ['A', 'B'], series: [{ name: 'M16', points: [[0, 5], [1, 7]] }] })) as Record<string, any>;
    const line = chartOption(chart({ shape: 'Line' })) as Record<string, any>;

    expect(stackedArea['series'][0].stack).toBe('total');
    expect(stackedBar['series'][0]).toMatchObject({ type: 'bar', stack: 'total' });
    expect(line['series'][0].areaStyle).toBeUndefined();
  });

  it('lines category values up with their categories, leaving gaps as null', () => {
    const c = chart({ shape: 'StackedBar', x: 'Category', categories: ['Ambush', 'Patrol', 'Bunker'], series: [{ name: 'M60', points: [[0, 50], [2, 9]] }] });

    const o = chartOption(c) as Record<string, any>;

    expect(o['xAxis'].type).toBe('category');
    expect(o['xAxis'].data).toEqual(['Ambush', 'Patrol', 'Bunker']);
    expect(o['series'][0].data).toEqual([50, null, 9]);
    expect(o['dataZoom']).toBeUndefined();
  });

  it('labels hours of the day and fixes that axis to 0-23', () => {
    const o = chartOption(chart({ x: 'Hour', series: [{ name: 'A', points: [[3, 1], [16, 5]] }] })) as Record<string, any>;

    expect(o['xAxis']).toMatchObject({ type: 'value', min: 0, max: 23 });
    expect(o['xAxis'].axisLabel.formatter(7)).toBe('07:00');
  });

  it('gives series with no fixed colour distinct colours from the palette, wrapping round when there are many', () => {
    expect(seriesColour('Patrol', 0)).toBe(DARK.palette[0]);
    expect(seriesColour('Ambush', 1)).toBe(DARK.palette[1]);
    expect(seriesColour('x', DARK.palette.length)).toBe(DARK.palette[0]);
    expect(seriesColour('Other', 3)).toBe(DARK.named['Other']);
  });

  it('turns animation off for very large charts so they draw at once', () => {
    const points: [number, number][] = Array.from({ length: 3500 }, (_, i) => [utc(1966, 1, 1) + i * 86400000, i]);

    expect((chartOption(chart({ series: [{ name: 'A', points }] })) as Record<string, unknown>)['animation']).toBe(false);
    expect((chartOption(chart()) as Record<string, unknown>)['animation']).toBe(true);
  });
});

describe('chartTable and formatX', () => {
  it('lists every x once, in order, with a column for each series and blanks where a series has no point', () => {
    const c = chart({ series: [{ name: 'A', points: [[utc(1966, 8, 19), 5], [utc(1966, 8, 18), 3]] }, { name: 'B', points: [[utc(1966, 8, 19), 1]] }] });

    const t = chartTable(c);

    expect(t.columns).toEqual(['Date', 'A', 'B']);
    expect(t.rows).toEqual([['1966-08-18', '3', ''], ['1966-08-19', '5', '1']]);
  });

  it('shows months for monthly data, hours as clock times and categories by name', () => {
    expect(chartTable(chart({ series: [{ name: 'A', points: [[utc(1966, 8, 1), 1], [utc(1966, 9, 1), 2]] }] })).rows.map((r) => r[0])).toEqual(['1966-08', '1966-09']);
    expect(formatX(chart({ x: 'Hour' }), 7)).toBe('07:00');
    expect(formatX(chart({ x: 'Category', categories: ['Ambush', 'Patrol'] }), 1)).toBe('Patrol');
    expect(formatX(chart({ x: 'Value' }), 40)).toBe('40');
  });

  it('knows when a chart has nothing to draw', () => {
    expect(isEmpty(chart({ series: [] }))).toBe(true);
    expect(isEmpty(chart({ series: [{ name: 'A', points: [] }] }))).toBe(true);
    expect(isEmpty(chart())).toBe(false);
  });
});

describe('AnalyticsService', () => {
  it('lists the charts and draws one from the chosen ids, or from everything when there are none', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    const ctl = TestBed.inject(HttpTestingController);
    const service = TestBed.inject(AnalyticsService);

    void service.charts();
    ctl.expectOne('/api/analytics/charts');
    void service.draw('battle-damage-date', [1, 2]);
    expect(ctl.expectOne('/api/analytics/charts/battle-damage-date').request.body).toEqual({ ids: [1, 2] });
    void service.draw('weird id/x', null);
    expect(ctl.expectOne('/api/analytics/charts/weird%20id%2Fx').request.body).toEqual({ ids: null });
  });
});

describe('AnalyticsPanel', () => {
  let service: { charts: ReturnType<typeof vi.fn>; draw: ReturnType<typeof vi.fn> };

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  function setup(inputs: { ids?: number[]; filtered?: boolean } = {}, draw?: (id: string, ids: readonly number[] | null) => Promise<ChartResult>, list: ChartInfo[] | Error = CHARTS) {
    TestBed.resetTestingModule();
    service = {
      charts: vi.fn(() => (list instanceof Error ? Promise.reject(list) : Promise.resolve(list))),
      draw: vi.fn(draw ?? ((id: string) => Promise.resolve({ ...CHART, id }))),
    };
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: AnalyticsService, useValue: service }] });
    stubEchartIn(AnalyticsPanel);
    const fixture = TestBed.createComponent(AnalyticsPanel);
    fixture.componentRef.setInput('ids', inputs.ids ?? [1, 2, 3]);
    fixture.componentRef.setInput('filtered', inputs.filtered ?? false);
    return fixture;
  }

  async function settle(f: ComponentFixture<unknown>, ms = 0) {
    for (let i = 0; i < 4; i++) {
      f.detectChanges();
      await vi.advanceTimersByTimeAsync(Math.max(ms, 1));      // a zero-delay timer only fires once the clock has moved on a millisecond
    }
    await f.whenStable();
    f.detectChanges();
  }

  const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
  const scope = (f: ComponentFixture<unknown>) => el(f).querySelector('.ap__scope')?.textContent?.replace(/\s+/g, ' ').trim();

  it('lists the charts in groups, draws the first straight away from every contact, and says so', async () => {
    const f = setup();
    await settle(f);

    expect([...el(f).querySelectorAll('optgroup')].map((g) => g.getAttribute('label'))).toEqual(['Casualties', 'People (all service)']);
    expect(service.draw).toHaveBeenCalledOnce();
    expect(service.draw).toHaveBeenCalledWith('battle-damage-date', null);
    expect(el(f).querySelector('.ap__about')?.textContent).toBe('Killed and wounded each day.');
    expect(scope(f)).toBe('All 3 contacts.');
    expect(f.debugElement.query((d) => d.componentInstance instanceof StubEChart)).not.toBeNull();
  });

  it('draws from the ids the map shows when a filter is on, after a short pause, and only once for a burst of changes', async () => {
    const f = setup({ ids: [1, 2, 3], filtered: true });
    await settle(f);
    expect(service.draw).toHaveBeenLastCalledWith('battle-damage-date', [1, 2, 3]);

    f.componentRef.setInput('ids', [1, 2]);
    f.detectChanges();
    f.componentRef.setInput('ids', [1]);
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(REFRESH_DELAY_MS - 50);
    expect(service.draw).toHaveBeenCalledTimes(1);

    await settle(f, 100);
    expect(service.draw).toHaveBeenCalledTimes(2);
    expect(service.draw).toHaveBeenLastCalledWith('battle-damage-date', [1]);
    expect(scope(f)).toBe('3 filtered contacts.');
  });

  it('draws a newly chosen chart at once, and a people chart ignores the filters and says so', async () => {
    const f = setup({ ids: [1], filtered: true });
    await settle(f);

    const select = el(f).querySelector('select')!;
    select.value = 'age-at-death';
    select.dispatchEvent(new Event('change'));
    f.detectChanges();
    await settle(f);

    expect(service.draw).toHaveBeenLastCalledWith('age-at-death', null);
    expect(scope(f)).toContain('The map\'s filters do not change it.');
  });

  it('ignores an answer that arrives after a newer question', async () => {
    const pending: ((r: ChartResult) => void)[] = [];
    const f = setup({ ids: [1], filtered: true }, () => new Promise((resolve) => pending.push(resolve)));
    await settle(f);
    expect(pending).toHaveLength(1);

    f.componentRef.setInput('ids', [2]);
    await settle(f, REFRESH_DELAY_MS + 50);
    expect(pending).toHaveLength(2);

    pending[1]({ ...CHART, rows: 42 });
    await settle(f);
    pending[0]({ ...CHART, rows: 1 });
    await settle(f);

    expect(scope(f)).toBe('42 filtered contacts.');
  });

  it('says so when there is nothing to chart, and when a chart cannot be drawn', async () => {
    const empty = setup({}, () => Promise.resolve({ ...CHART, series: [], rows: 0 }));
    await settle(empty);
    expect(el(empty).querySelector('.ap__empty')?.textContent).toContain('Nothing to chart');
    expect(empty.debugElement.query((d) => d.componentInstance instanceof StubEChart)).toBeNull();

    const broken = setup({}, () => Promise.reject(new Error('down')));
    await settle(broken);
    expect(el(broken).querySelector('[role=alert]')?.textContent).toContain('could not be drawn');
  });

  it('says so when the list of charts cannot be loaded', async () => {
    const f = setup({}, undefined, new Error('down'));
    await settle(f);

    expect(el(f).querySelector('[role=alert]')?.textContent).toContain('list of charts');
    expect(service.draw).not.toHaveBeenCalled();
  });

  it('shows the note that comes with a chart', async () => {
    const f = setup({}, () => Promise.resolve({ ...CHART, note: 'Only ranges that were recorded are shown.' }));
    await settle(f);

    expect(el(f).querySelector('.ap__note')?.textContent).toBe('Only ranges that were recorded are shown.');
  });

  it('offers the figures as a table, built only when it is opened', async () => {
    const f = setup();
    await settle(f);
    expect(el(f).querySelector('table')).toBeNull();

    const details = el(f).querySelector<HTMLDetailsElement>('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await settle(f);

    const rows = [...el(f).querySelectorAll('tbody tr')].map((r) => [...r.children].map((c) => c.textContent?.trim()));
    expect(rows).toEqual([['1966-03-03', '3'], ['1966-03-05', '7']]);
    expect(el(f).querySelector('thead')?.textContent).toContain('Enemy killed');
  });

  it('on a phone, leaves out the table of figures', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === NARROW_SCREEN }));
    try {
      const f = setup();
      await settle(f);

      expect(el(f).querySelector('app-echart')).not.toBeNull();
      expect(el(f).querySelector('details')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('closes on request', async () => {
    const f = setup();
    let closed = 0;
    f.componentInstance.closed.subscribe(() => closed++);
    await settle(f);

    el(f).querySelector<HTMLButtonElement>('.ap__close')!.click();

    expect(closed).toBe(1);
  });
});
