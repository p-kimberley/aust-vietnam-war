import { ChangeDetectionStrategy, Component, OnDestroy, computed, input, output, signal } from '@angular/core';
import { Contact } from '../contacts';
import { ChartOption, DARK, ChartTheme } from './analytics';
import { EChart, ZoomRange } from './echart';

const DAY = 24 * 3600 * 1000;

/** How often the play button moves the window on, and by how many months. */
export const PLAY_INTERVAL_MS = 400;
export const PLAY_STEP_MONTHS = 1;
/** A window shorter than this is widened to it when play starts, so there is something to watch. */
export const PLAY_MIN_MONTHS = 3;

export interface MonthBucket {
  /** UTC midnight on the first of the month, in milliseconds. */
  t: number;
  /** All contacts that month. */
  all: number;
  /** Contacts that month that pass the filters. */
  shown: number;
}

export interface DateRange {
  /** `yyyy-MM-dd`, inclusive, or `null` for no limit on that side. */
  from: string | null;
  to: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Parses the date part of `yyyy-MM-dd…` as UTC midnight. */
export function dayMs(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

export function formatDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function monthStart(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, 1);
}

function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate());
}

/** Contacts per month, for every month from the first contact to the last (empty months included, so the bars keep their spacing). */
export function monthBuckets(all: readonly Contact[], visible: readonly Contact[]): MonthBucket[] {
  if (all.length === 0) {
    return [];
  }
  const shown = new Map<number, number>();
  for (const c of visible) {
    const t = monthStart(c.dtg);
    shown.set(t, (shown.get(t) ?? 0) + 1);
  }
  const total = new Map<number, number>();
  for (const c of all) {
    const t = monthStart(c.dtg);
    total.set(t, (total.get(t) ?? 0) + 1);
  }
  const times = [...total.keys()];
  const first = Math.min(...times);
  const last = Math.max(...times);
  const buckets: MonthBucket[] = [];
  for (let t = first; t <= last; t = addMonths(t, 1)) {
    buckets.push({ t, all: total.get(t) ?? 0, shown: shown.get(t) ?? 0 });
  }
  return buckets;
}

/** The start of the timeline and the day after its last month, the limits of the slider. */
export function limits(buckets: readonly MonthBucket[]): { min: number; max: number } | null {
  return buckets.length ? { min: buckets[0].t, max: addMonths(buckets[buckets.length - 1].t, 1) } : null;
}

/** The slider position for a date range; an open end sits at the end of the timeline. */
export function rangeToZoom(range: DateRange, min: number, max: number): ZoomRange {
  const start = range.from ? Math.max(min, dayMs(range.from)) : min;
  const end = range.to ? Math.min(max, dayMs(range.to) + DAY) : max;
  return { start, end: Math.max(end, start + DAY) };
}

/** The date range for a slider position. Where the slider touches an end of the timeline, that side is left open. */
export function zoomToRange(zoom: ZoomRange, min: number, max: number): DateRange {
  const start = Math.round(zoom.start);
  const end = Math.round(zoom.end);
  return {
    from: start <= min + DAY / 2 ? null : formatDay(start),
    to: end >= max - DAY / 2 ? null : formatDay(end - DAY / 2),
  };
}

/**
 * The window after one step of play, or `null` once it has run off the end of the timeline. With no range set, play starts
 * from the first few months; otherwise it slides the current window on by a month, keeping its width.
 */
export function nextWindow(range: DateRange, min: number, max: number): DateRange | null {
  let start: number;
  let end: number;
  if (range.from === null && range.to === null) {
    start = min;
    end = addMonths(min, PLAY_MIN_MONTHS);
  } else {
    const zoom = rangeToZoom(range, min, max);
    start = addMonths(zoom.start, PLAY_STEP_MONTHS);
    end = addMonths(zoom.end, PLAY_STEP_MONTHS);
  }
  if (start >= max) {
    return null;
  }
  return { from: formatDay(start), to: formatDay(Math.min(end, max) - DAY) };
}

/** The bar chart behind the slider: every month grey, the months that pass the filters bright, and a slider to pick a stretch of time. */
export function timelineOption(buckets: readonly MonthBucket[], range: DateRange, theme: ChartTheme = DARK): ChartOption {
  const lim = limits(buckets);
  const zoom = lim ? rangeToZoom(range, lim.min, lim.max) : undefined;
  return {
    aria: { enabled: true },
    animation: false,
    textStyle: { color: theme.text },
    grid: { left: 8, right: 12, top: 6, bottom: 62, containLabel: false },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(31, 35, 20, 0.95)',
      borderColor: theme.grid,
      textStyle: { color: theme.text },
    },
    xAxis: {
      type: 'time',
      min: lim?.min,
      max: lim?.max,
      axisLabel: { color: theme.muted },
      axisLine: { lineStyle: { color: theme.grid } },
      splitLine: { show: false },
    },
    yAxis: { type: 'value', show: false },
    dataZoom: [
      {
        type: 'slider',
        height: 36,
        bottom: 4,
        realtime: false,           // report when the handle is let go, not on every pixel of a drag
        filterMode: 'none',
        startValue: zoom?.start,
        endValue: zoom?.end,
        textStyle: { color: theme.muted },
        borderColor: theme.grid,
        fillerColor: 'rgba(227, 185, 46, 0.22)',
        handleStyle: { color: '#e3b92e' },
        // The slider doubles as the whole-war overview: its background is the contacts of every month, the window on top of it.
        dataBackground: { lineStyle: { color: '#b9ac80', width: 1 }, areaStyle: { color: 'rgba(185, 172, 128, 0.35)' } },
        selectedDataBackground: { lineStyle: { color: '#e3b92e', width: 1 }, areaStyle: { color: 'rgba(227, 185, 46, 0.6)' } },
      },
    ],
    series: [
      {
        name: 'All contacts',
        type: 'bar',
        barGap: '-100%',
        barCategoryGap: '10%',
        itemStyle: { color: 'rgba(185, 172, 128, 0.35)' },
        data: buckets.map((b) => [b.t, b.all]),
      },
      {
        name: 'Shown',
        type: 'bar',
        itemStyle: { color: '#e3b92e' },
        data: buckets.map((b) => [b.t, b.shown]),
      },
    ],
  };
}

/**
 * The strip along the bottom of the map: contacts per month, with a slider that sets the date filter. Play moves a window of
 * time along the timeline so the map shows the war unfolding.
 */
@Component({
  selector: 'app-timeline',
  imports: [EChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tl" aria-label="Timeline">
      <div class="tl__controls">
        <button type="button" class="tl__play" [attr.aria-pressed]="playing()" (click)="togglePlay()">{{ playing() ? 'Pause' : 'Play' }}</button>
        <span class="tl__range data" aria-live="polite">{{ label() }}</span>
        @if (from() || to()) {
          <button type="button" class="tl__reset" (click)="reset()">Whole war</button>
        }
      </div>
      <div class="tl__chart">
        <app-echart [option]="option()" (zoomed)="zoomed($event)" />
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .tl {
      display: flex;
      align-items: stretch;
      gap: 0.75rem;
      height: 100%;
      padding: 0.4rem 0.75rem;
      background: rgb(31 35 20 / 0.94);
      border-top: 2px solid var(--brass);
      color: var(--paper);
    }
    .tl__controls {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 0.3rem;
      min-width: 8.5rem;
    }
    .tl__play,
    .tl__reset {
      padding: 0.25rem 0.6rem;
      border: 1px solid var(--olive-500);
      background: var(--olive-700);
      color: var(--paper);
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .tl__play {
      background: var(--brass);
      color: var(--ink);
      border-color: var(--brass);
    }
    .tl__range {
      font-size: 0.8rem;
      color: var(--khaki);
    }
    .tl__chart {
      flex: 1;
      min-width: 0;
    }
  `,
})
export class Timeline implements OnDestroy {
  readonly all = input.required<readonly Contact[]>();
  readonly visible = input.required<readonly Contact[]>();
  readonly from = input<string | null>(null);
  readonly to = input<string | null>(null);
  readonly rangeChange = output<DateRange>();

  protected readonly playing = signal(false);
  private timer?: ReturnType<typeof setInterval>;

  private readonly buckets = computed(() => monthBuckets(this.all(), this.visible()));
  protected readonly option = computed(() => timelineOption(this.buckets(), { from: this.from(), to: this.to() }));
  protected readonly label = computed(() => {
    const from = this.from();
    const to = this.to();
    return from || to ? `${from ?? 'the start'} to ${to ?? 'the end'}` : 'The whole war';
  });

  protected zoomed(zoom: ZoomRange): void {
    const lim = limits(this.buckets());
    if (lim) {
      this.stop();
      this.rangeChange.emit(zoomToRange(zoom, lim.min, lim.max));
    }
  }

  protected reset(): void {
    this.stop();
    this.rangeChange.emit({ from: null, to: null });
  }

  protected togglePlay(): void {
    if (this.playing()) {
      this.stop();
      return;
    }
    const lim = limits(this.buckets());
    if (!lim) {
      return;
    }
    this.playing.set(true);
    this.timer = setInterval(() => {
      const next = nextWindow({ from: this.from(), to: this.to() }, lim.min, lim.max);
      if (next) {
        this.rangeChange.emit(next);
      } else {
        this.stop();
      }
    }, PLAY_INTERVAL_MS);
  }

  private stop(): void {
    clearInterval(this.timer);
    this.playing.set(false);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }
}
