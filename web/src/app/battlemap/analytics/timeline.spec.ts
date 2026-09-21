import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Contact } from '../contacts';
import { StubEChart, stubEchartIn } from './echart-stub';
import {
  DateRange,
  PLAY_INTERVAL_MS,
  Timeline,
  dayMs,
  formatDay,
  limits,
  monthBuckets,
  nextWindow,
  rangeToZoom,
  timelineOption,
  zoomToRange,
} from './timeline';

const DAY = 86_400_000;
const c = (id: number, dtg: string): Contact => ({ id, dtg, lat: 10, lon: 107, fr: 0, frCas: 0, en: 0, enCas: 0, frKia: 0, frWia: 0, enKia: 0, enWia: 0, units: [], op: 0, task: 0, series: 1, mine: 0 });

const CONTACTS = [c(1, '1966-01-05T10:00:00'), c(2, '1966-01-20T10:00:00'), c(3, '1966-04-02T10:00:00'), c(4, '1966-06-30T23:59:00')];
const MIN = Date.UTC(1966, 0, 1);
const MAX = Date.UTC(1966, 6, 1);                 // the day after the last month

describe('monthBuckets', () => {
  it('counts every contact and the shown ones for each month, keeping empty months in between', () => {
    const buckets = monthBuckets(CONTACTS, [CONTACTS[0], CONTACTS[2]]);

    expect(buckets.map((b) => [formatDay(b.t), b.all, b.shown])).toEqual([
      ['1966-01-01', 2, 1],
      ['1966-02-01', 0, 0],
      ['1966-03-01', 0, 0],
      ['1966-04-01', 1, 1],
      ['1966-05-01', 0, 0],
      ['1966-06-01', 1, 0],
    ]);
  });

  it('gives nothing for no contacts', () => {
    expect(monthBuckets([], [])).toEqual([]);
    expect(limits([])).toBeNull();
  });

  it('spans from the first month to the day after the last', () => {
    expect(limits(monthBuckets(CONTACTS, CONTACTS))).toEqual({ min: MIN, max: MAX });
  });
});

describe('date range and slider position', () => {
  it('reads a date range as a slider position, ending at the end of the last day, and open sides as the ends', () => {
    expect(rangeToZoom({ from: '1966-02-10', to: '1966-03-20' }, MIN, MAX)).toEqual({ start: dayMs('1966-02-10'), end: dayMs('1966-03-20') + DAY });
    expect(rangeToZoom({ from: null, to: null }, MIN, MAX)).toEqual({ start: MIN, end: MAX });
    expect(rangeToZoom({ from: '1960-01-01', to: '1999-01-01' }, MIN, MAX)).toEqual({ start: MIN, end: MAX });
    expect(rangeToZoom({ from: '1966-05-01', to: '1966-04-01' }, MIN, MAX).end).toBeGreaterThan(dayMs('1966-05-01'));      // never backwards
  });

  it('reads a slider position as a date range, leaving a side open where the slider touches the end', () => {
    expect(zoomToRange({ start: MIN, end: MAX }, MIN, MAX)).toEqual({ from: null, to: null });
    expect(zoomToRange({ start: dayMs('1966-02-10'), end: dayMs('1966-03-21') }, MIN, MAX)).toEqual({ from: '1966-02-10', to: '1966-03-20' });
    expect(zoomToRange({ start: MIN + 3 * 3600_000, end: dayMs('1966-03-21') }, MIN, MAX).from).toBeNull();
    expect(zoomToRange({ start: dayMs('1966-02-10') + 0.4, end: MAX - 1000 }, MIN, MAX)).toEqual({ from: '1966-02-10', to: null });
  });

  it('gives back the same range it was given', () => {
    const range: DateRange = { from: '1966-02-10', to: '1966-03-20' };

    expect(zoomToRange(rangeToZoom(range, MIN, MAX), MIN, MAX)).toEqual(range);
  });
});

describe('nextWindow (play)', () => {
  it('starts with the first few months when no range is set', () => {
    expect(nextWindow({ from: null, to: null }, MIN, MAX)).toEqual({ from: '1966-01-01', to: '1966-03-31' });
  });

  it('slides the window on a month at a time, keeping its width', () => {
    expect(nextWindow({ from: '1966-01-01', to: '1966-03-31' }, MIN, MAX)).toEqual({ from: '1966-02-01', to: '1966-04-30' });
    expect(nextWindow({ from: '1966-02-01', to: '1966-04-30' }, MIN, MAX)).toEqual({ from: '1966-03-01', to: '1966-05-31' });
  });

  it('shortens the window at the end of the timeline and then stops', () => {
    expect(nextWindow({ from: '1966-03-01', to: '1966-05-31' }, MIN, MAX)).toEqual({ from: '1966-04-01', to: '1966-06-30' });
    expect(nextWindow({ from: '1966-04-01', to: '1966-06-30' }, MIN, MAX)).toEqual({ from: '1966-05-01', to: '1966-06-30' });
    expect(nextWindow({ from: '1966-06-01', to: '1966-06-30' }, MIN, MAX)).toBeNull();
  });
});

describe('timelineOption', () => {
  it('draws every month grey and the shown ones bright, with the slider on the range', () => {
    const buckets = monthBuckets(CONTACTS, [CONTACTS[0]]);

    const o = timelineOption(buckets, { from: '1966-02-01', to: '1966-03-31' }) as Record<string, any>;

    expect(o['series'].map((s: any) => s.name)).toEqual(['All contacts', 'Shown']);
    expect(o['series'][0].data[0]).toEqual([MIN, 2]);
    expect(o['series'][1].data[0]).toEqual([MIN, 1]);
    expect(o['dataZoom'][0]).toMatchObject({ type: 'slider', startValue: dayMs('1966-02-01'), endValue: dayMs('1966-03-31') + DAY, realtime: false });
    expect(o['xAxis']).toMatchObject({ type: 'time', min: MIN, max: MAX });
  });

  it('copes with no contacts at all', () => {
    const o = timelineOption([], { from: null, to: null }) as Record<string, any>;

    expect(o['series'][0].data).toEqual([]);
    expect(o['dataZoom'][0].startValue).toBeUndefined();
  });
});

describe('Timeline', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  function setup(range: DateRange = { from: null, to: null }) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    stubEchartIn(Timeline);
    const f: ComponentFixture<Timeline> = TestBed.createComponent(Timeline);
    f.componentRef.setInput('all', CONTACTS);
    f.componentRef.setInput('visible', CONTACTS);
    f.componentRef.setInput('from', range.from);
    f.componentRef.setInput('to', range.to);
    const emitted: DateRange[] = [];
    f.componentInstance.rangeChange.subscribe((r) => emitted.push(r));
    f.detectChanges();
    const chart = () => f.debugElement.query((d) => d.componentInstance instanceof StubEChart).componentInstance as StubEChart;
    const el = f.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;
    return { f, emitted, chart, el, button };
  }

  it('describes the range and offers to go back to the whole war only when one is set', () => {
    const open = setup();
    expect(open.el.querySelector('.tl__range')?.textContent).toBe('The whole war');
    expect(open.button('Whole war')).toBeUndefined();

    const set = setup({ from: '1966-02-01', to: null });
    expect(set.el.querySelector('.tl__range')?.textContent).toBe('1966-02-01 to the end');
    expect(set.button('Whole war')).toBeDefined();
  });

  it('hands the chart the option built from the contacts and the range', () => {
    const { chart } = setup({ from: '1966-02-01', to: '1966-03-31' });

    expect((chart().option() as Record<string, any>)['dataZoom'][0].startValue).toBe(dayMs('1966-02-01'));
  });

  it('turns a slider change into a date range', () => {
    const { chart, emitted } = setup();

    chart().zoomed.emit({ start: dayMs('1966-02-10'), end: dayMs('1966-03-21') });

    expect(emitted).toEqual([{ from: '1966-02-10', to: '1966-03-20' }]);
  });

  it('clears the range on request', () => {
    const { emitted, button, f } = setup({ from: '1966-02-01', to: '1966-03-31' });

    button('Whole war').click();
    f.detectChanges();

    expect(emitted).toEqual([{ from: null, to: null }]);
  });

  it('plays: moves the window along at a steady pace, and stops at the end', async () => {
    const { f, emitted, button } = setup();

    button('Play').click();
    f.detectChanges();
    expect(button('Pause')).toBeDefined();

    await vi.advanceTimersByTimeAsync(PLAY_INTERVAL_MS);
    expect(emitted.at(-1)).toEqual({ from: '1966-01-01', to: '1966-03-31' });

    // The parent applies each window; feed it back as the component's inputs, as the map does.
    for (let i = 0; i < 10 && emitted.length; i++) {
      const last = emitted.at(-1)!;
      f.componentRef.setInput('from', last.from);
      f.componentRef.setInput('to', last.to);
      f.detectChanges();
      await vi.advanceTimersByTimeAsync(PLAY_INTERVAL_MS);
    }

    expect(emitted.map((r) => r.from)).toEqual(['1966-01-01', '1966-02-01', '1966-03-01', '1966-04-01', '1966-05-01', '1966-06-01']);
    expect(emitted.at(-1)!.to).toBe('1966-06-30');
    f.detectChanges();
    expect(button('Play')).toBeDefined();                                // it stopped by itself
  });

  it('pauses when asked, and when the reader moves the slider', async () => {
    const { f, emitted, button, chart } = setup();

    button('Play').click();
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(PLAY_INTERVAL_MS);
    button('Pause').click();
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(PLAY_INTERVAL_MS * 3);
    expect(emitted).toHaveLength(1);

    button('Play').click();
    f.detectChanges();
    chart().zoomed.emit({ start: dayMs('1966-02-10'), end: dayMs('1966-03-21') });
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(PLAY_INTERVAL_MS * 3);
    expect(emitted).toHaveLength(2);
    expect(button('Play')).toBeDefined();
  });
});
