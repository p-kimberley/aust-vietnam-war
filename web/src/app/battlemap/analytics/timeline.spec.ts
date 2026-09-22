import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Contact } from '../contacts';
import { StubEChart, stubEchartIn } from './echart-stub';
import {
  DateRange,
  PLAY_INTERVAL_MS,
  Timeline,
  bucketIntervalMs,
  dayMs,
  formatDay,
  intervalBuckets,
  limits,
  monthBuckets,
  nextWindow,
  rangeToZoom,
  timelineOption,
  zoomToRange,
} from './timeline';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
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

describe('bucketIntervalMs', () => {
  it('picks an hour for a stretch that short, and never anything finer', () => {
    expect(bucketIntervalMs(HOUR)).toBe(HOUR);
    expect(bucketIntervalMs(1)).toBe(HOUR);
  });

  it('widens through the ladder of steps as the stretch grows, always leaving at most 90 bars', () => {
    for (const spanMs of [3 * HOUR, DAY, 10 * DAY, 100 * DAY, 1000 * DAY]) {
      const ms = bucketIntervalMs(spanMs)!;
      expect(ms).not.toBeNull();
      expect(spanMs / ms).toBeLessThanOrEqual(90);
    }
    expect(bucketIntervalMs(DAY)).toBeLessThan(bucketIntervalMs(30 * DAY)!);
  });

  it('gives up once even three weeks would still crowd the chart, since the stretch runs to years', () => {
    expect(bucketIntervalMs(1890 * DAY)).not.toBeNull();               // 21-day bars still fit
    expect(bucketIntervalMs(1891 * DAY)).toBeNull();                   // a hair over: calendar months suit it better
    expect(bucketIntervalMs(2000 * DAY)).toBeNull();
  });

  it('never picks a step so fine that the whole axis would need more than 3000 buckets, however narrow the stretch shown is', () => {
    // A drag down to a single hour, on an axis spanning six years, would otherwise ask for tens of thousands of hourly bars.
    const sixYears = 6 * 365 * DAY;
    expect(bucketIntervalMs(HOUR, sixYears)).toBe(DAY);                // 6 years / 3000 buckets ≈ 17.5h, so a day is the next step up
    expect(sixYears / bucketIntervalMs(HOUR, sixYears)!).toBeLessThanOrEqual(3000);

    // Leaving axisSpanMs out defaults it to spanMs itself, so a caller that only cares about the shown stretch is unaffected.
    expect(bucketIntervalMs(HOUR)).toBe(HOUR);
  });
});

describe('intervalBuckets', () => {
  const min = Date.UTC(1966, 0, 1);

  it('counts every contact and the shown ones per interval, anchored to min, empty ones included', () => {
    const contacts = [c(1, '1966-01-01T00:30:00'), c(2, '1966-01-01T05:00:00'), c(3, '1966-01-01T08:15:00')];
    const max = min + 12 * HOUR;

    const buckets = intervalBuckets(contacts, [contacts[0], contacts[2]], min, max, 6 * HOUR);

    expect(buckets.map((b) => [formatDay(b.t) + ' ' + new Date(b.t).getUTCHours(), b.all, b.shown])).toEqual([
      ['1966-01-01 0', 2, 1],           // 00:30 and 05:00 both fall in the first six hours
      ['1966-01-01 6', 1, 1],
    ]);
    expect(buckets[0].end).toBe(min + 6 * HOUR);
  });

  it('leaves out anything at or past max, or before min', () => {
    const max = min + HOUR;
    const contacts = [c(1, '1966-01-01T00:30:00'), c(2, '1966-01-01T01:00:00'), c(3, '1965-12-31T23:00:00')];

    const buckets = intervalBuckets(contacts, contacts, min, max, HOUR);

    expect(buckets.map((b) => b.all)).toEqual([1]);
  });

  it('gives one bucket per hour when asked for hours, on the hour', () => {
    const buckets = intervalBuckets([], [], min, min + 3 * HOUR, HOUR);

    expect(buckets.map((b) => new Date(b.t).getUTCHours())).toEqual([0, 1, 2]);
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
    expect(open.button('Reset zoom')).toBeUndefined();

    const set = setup({ from: '1966-02-01', to: null });
    expect(set.el.querySelector('.tl__range')?.textContent).toBe('1966-02-01 to the end');
    expect(set.button('Reset zoom')).toBeDefined();
  });

  it('hands the chart the option built from the contacts and the range', () => {
    const { chart } = setup({ from: '1966-02-01', to: '1966-03-31' });

    expect((chart().option() as Record<string, any>)['dataZoom'][0].startValue).toBe(dayMs('1966-02-01'));
  });

  describe('the bar interval', () => {
    const bars = (o: unknown) => (o as Record<string, any>)['series'][0].data as [number, number][];
    const spacing = (o: unknown) => {
      const data = bars(o);
      return data.length > 1 ? data[1][0] - data[0][0] : null;
    };

    it('narrows automatically as the reader zooms in, but never below what the whole axis can afford', () => {
      const { chart } = setup();
      const whole = spacing(chart().option());

      const zoomed = setup({ from: '1966-01-01', to: '1966-01-02' });
      const narrow = spacing(zoomed.chart().option());
      expect(narrow).toBeLessThan(whole!);

      // Narrower still, but the fixture's ~181-day axis caps the floor above an hour (see bucketIntervalMs's axis-wide cap),
      // so a single day's drag settles on 2-hour bars rather than 1-hour ones.
      const tiny = setup({ from: '1966-01-01', to: '1966-01-01' });
      expect(spacing(tiny.chart().option())).toBe(2 * HOUR);
    });

    it('still spans the whole war, whatever the bars are bucketed by, so the overview slider keeps the whole shape', () => {
      const { chart } = setup({ from: '1966-01-01', to: '1966-01-02' });

      const data = bars(chart().option());
      expect(data[0][0]).toBe(MIN);
      expect(data[data.length - 1][0]).toBeLessThan(MAX);
    });

    it('falls back to calendar months once the stretch shown runs to years, so the bars stay few enough to read', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
      stubEchartIn(Timeline);
      const f: ComponentFixture<Timeline> = TestBed.createComponent(Timeline);
      const long = [c(1, '1966-01-05T10:00:00'), c(2, '1971-11-02T23:59:00')];       // about six years apart
      f.componentRef.setInput('all', long);
      f.componentRef.setInput('visible', long);
      f.detectChanges();
      const chart = f.debugElement.query((d) => d.componentInstance instanceof StubEChart).componentInstance as StubEChart;

      expect(bars(chart.option()).map((b) => formatDay(b[0])).slice(0, 2)).toEqual(['1966-01-01', '1966-02-01']);
    });
  });

  it('turns a slider change into a date range', () => {
    const { chart, emitted } = setup();

    chart().zoomed.emit({ start: dayMs('1966-02-10'), end: dayMs('1966-03-21') });

    expect(emitted).toEqual([{ from: '1966-02-10', to: '1966-03-20' }]);
  });

  it('clears the range on request', () => {
    const { emitted, button, f } = setup({ from: '1966-02-01', to: '1966-03-31' });

    button('Reset zoom').click();
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
