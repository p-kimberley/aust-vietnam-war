import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Contact, formatDtg } from '../contacts';
import { ChartOption, DARK, ChartTheme } from './analytics';
import { EChart, ZoomRange } from './echart';
import { Icon } from '../icon';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
/** The site's data font (--font-data), for the chart's tooltip, which does not read the page's styles. */
const DATA_FONT = "'Courier Prime', 'Courier New', monospace";

/** The margins round the bars inside the chart's box, in pixels. A drag across the bars is measured against them. */
export const CHART_GRID = { left: 8, right: 12, top: 6, bottom: 62 } as const;

/** How long the slider's handles must be still before the dates they show are applied to the map. */
export const ZOOM_SETTLE_MS = 300;

/** Nearer an end of the timeline than this (a share of it), a handle's date sits inside the window rather than outside it. */
const LABEL_INSIDE_WITHIN = 0.12;

/** How often the play button moves the window on. */
export const PLAY_INTERVAL_MS = 400;
/** The speeds play can go at, chosen from the menu beside Play: how many days the window moves on at each step. */
export const PLAY_SPEEDS = [
  { id: 'slow', name: 'Slow', days: 1 },
  { id: 'normal', name: 'Normal', days: 3 },
  { id: 'fast', name: 'Fast', days: 10 },
] as const;
export type PlaySpeed = (typeof PLAY_SPEEDS)[number]['id'];
export const DEFAULT_PLAY_SPEED: PlaySpeed = 'normal';
const playDays = (speed: PlaySpeed) => PLAY_SPEEDS.find((s) => s.id === speed)!.days;
/** A window shorter than this is widened to it when play starts, so there is something to watch. */
export const PLAY_MIN_MONTHS = 3;

export interface MonthBucket {
  /** The start of the bucket, in UTC milliseconds: midnight on the first of the month, unless it is a finer bucket (see {@link intervalBuckets}). */
  t: number;
  /** The moment the bucket ends (the start of the next one), in UTC milliseconds. */
  end: number;
  /** All contacts in the bucket. */
  all: number;
  /** Contacts in the bucket that pass the filters. */
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

/** The exact moment `dtg` records (not just its day), in UTC milliseconds. */
function dtgMs(dtg: string): number {
  const h = dtg.length > 12 ? Number(dtg.slice(11, 13)) : 0;
  const min = dtg.length > 15 ? Number(dtg.slice(14, 16)) : 0;
  const s = dtg.length > 18 ? Number(dtg.slice(17, 19)) : 0;
  return dayMs(dtg) + ((h * 60 + min) * 60 + s) * 1000;
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
    buckets.push({ t, end: addMonths(t, 1), all: total.get(t) ?? 0, shown: shown.get(t) ?? 0 });
  }
  return buckets;
}

/** More bars than this would crowd the chart and cost more to draw than they are worth. */
const MAX_BARS = 90;

/**
 * However fine the stretch shown would suggest, buckets are never so many across the *whole* timeline (they always span
 * it; see {@link intervalBuckets}) that building and drawing them costs real time. A drag that picks a stretch of minutes,
 * on a timeline of years, would otherwise ask for tens of thousands of hourly buckets to cover years it cannot see.
 */
const MAX_TOTAL_BUCKETS = 3000;

/** The bucket widths {@link bucketIntervalMs} chooses from, closest fit first; never finer than an hour. */
const BUCKET_STEPS_MS = [
  HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 3 * DAY, 5 * DAY, 7 * DAY, 14 * DAY, 21 * DAY,
];

/**
 * The width of one bar, chosen automatically from the stretch of time shown so there are at most {@link MAX_BARS} of them:
 * hours when zoomed in close, widening through days as the stretch grows. Never finer, either, than leaves at most
 * {@link MAX_TOTAL_BUCKETS} across `axisSpanMs` (the whole timeline, which defaults to `spanMs` itself, for a caller that
 * only cares about the shown stretch). `null` once even the widest of these steps would still crowd the chart (the stretch
 * is some years), which means calendar months (see {@link monthBuckets}) suit it better.
 */
export function bucketIntervalMs(spanMs: number, axisSpanMs: number = spanMs): number | null {
  const minForWholeAxis = axisSpanMs / MAX_TOTAL_BUCKETS;
  return BUCKET_STEPS_MS.find((ms) => ms >= minForWholeAxis && spanMs / ms <= MAX_BARS) ?? null;
}

/**
 * Contacts per `intervalMs`, from `min` (inclusive) to `max` (exclusive) — the same span {@link monthBuckets} would give for
 * the same contacts, just finer. `min` is always a calendar month start (so a whole day, and a whole hour), and every bucket
 * is anchored to it, so the bars fall on round times: midnight, or the top of the hour. Empty buckets are included, so the
 * bars keep their spacing.
 */
export function intervalBuckets(all: readonly Contact[], visible: readonly Contact[], min: number, max: number, intervalMs: number): MonthBucket[] {
  const bucketOf = (dtg: string) => min + Math.floor((dtgMs(dtg) - min) / intervalMs) * intervalMs;
  const shown = new Map<number, number>();
  for (const c of visible) {
    const t = bucketOf(c.dtg);
    if (t >= min && t < max) {
      shown.set(t, (shown.get(t) ?? 0) + 1);
    }
  }
  const total = new Map<number, number>();
  for (const c of all) {
    const t = bucketOf(c.dtg);
    if (t >= min && t < max) {
      total.set(t, (total.get(t) ?? 0) + 1);
    }
  }
  const buckets: MonthBucket[] = [];
  for (let t = min; t < max; t += intervalMs) {
    buckets.push({ t, end: t + intervalMs, all: total.get(t) ?? 0, shown: shown.get(t) ?? 0 });
  }
  return buckets;
}

/** The start of the timeline and the end of its last bucket, the limits of the slider. */
export function limits(buckets: readonly MonthBucket[]): { min: number; max: number } | null {
  return buckets.length ? { min: buckets[0].t, max: buckets[buckets.length - 1].end } : null;
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
 * from the first few months; otherwise it slides the current window on by `stepDays`, keeping its width.
 */
export function nextWindow(range: DateRange, min: number, max: number, stepDays: number = playDays(DEFAULT_PLAY_SPEED)): DateRange | null {
  let start: number;
  let end: number;
  if (range.from === null && range.to === null) {
    start = min;
    end = addMonths(min, PLAY_MIN_MONTHS);
  } else {
    const zoom = rangeToZoom(range, min, max);
    start = zoom.start + stepDays * DAY;
    end = zoom.end + stepDays * DAY;
  }
  if (start >= max) {
    return null;
  }
  return { from: formatDay(start), to: formatDay(Math.min(end, max) - DAY) };
}

/**
 * The bar chart behind the slider: every month grey, the months that pass the filters bright, and a slider to pick a stretch
 * of time. The slider normally sits on `range`, but `zoom` overrides it when given, so the chart can be made to show the same
 * stretch of time as the operation list above it (for example while it is zoomed to an open incident) without touching the
 * date filter itself.
 */
export function timelineOption(buckets: readonly MonthBucket[], range: DateRange, zoom?: ZoomRange, theme: ChartTheme = DARK): ChartOption {
  const lim = limits(buckets);
  const shown = zoom ?? (lim ? rangeToZoom(range, lim.min, lim.max) : undefined);
  return {
    aria: { enabled: true },
    animation: false,
    textStyle: { color: theme.text },
    grid: { ...CHART_GRID, containLabel: false },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'shadow' },
      backgroundColor: 'rgba(31, 35, 20, 0.95)',
      borderColor: theme.grid,
      textStyle: { color: theme.text, fontFamily: DATA_FONT },
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
        // Level with the plot, so the dates drawn beside the handles (the timeline's own, not the chart's) sit on them.
        left: CHART_GRID.left,
        right: CHART_GRID.right,
        realtime: true,            // report as the handles move; the timeline applies the dates once they are still
        showDetail: false,
        filterMode: 'none',
        startValue: shown?.start,
        endValue: shown?.end,
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

/** When an operation ran: from the day of its first contact to the day of its last. */
export interface OperationSpan {
  /** The operation's 1-based number, as a contact's `op` has it. */
  op: number;
  name: string;
  /** UTC midnight, in milliseconds. */
  start: number;
  end: number;
  /** How many contacts belong to it. */
  count: number;
}

/**
 * The span of every operation that has contacts, earliest first. An operation has no dates of its own; it runs from its first
 * recorded contact to its last, which is how the Gantt chart draws it.
 */
export function operationSpans(all: readonly Contact[], operations: readonly { name: string }[]): OperationSpan[] {
  const spans = new Map<number, OperationSpan>();
  for (const c of all) {
    if (c.op < 1 || c.op > operations.length) {
      continue;
    }
    const day = dayMs(c.dtg);
    const span = spans.get(c.op);
    if (span) {
      span.start = Math.min(span.start, day);
      span.end = Math.max(span.end, day);
      span.count++;
    } else {
      spans.set(c.op, { op: c.op, name: operations[c.op - 1].name, start: day, end: day, count: 1 });
    }
  }
  return [...spans.values()].sort((a, b) => a.start - b.start || b.end - a.end || a.name.localeCompare(b.name));
}

/** An operation placed on the timeline's axis, in percent of its width. */
export interface GanttRow extends OperationSpan {
  left: number;
  width: number;
  /** The dates in words, for the tooltip and for a screen reader. */
  dates: string;
}

/** An operation of a day or two would be too thin to see, so no bar is narrower than this share of the axis. */
const MIN_BAR_PERCENT = 0.35;

/**
 * Places each operation that overlaps the axis from `min` to `max` (the same axis as the bar chart above it), in percent. A
 * bar that runs past either end is cut at the edge. The last day counts in full.
 */
export function ganttRows(spans: readonly OperationSpan[], min: number, max: number): GanttRow[] {
  const total = max - min;
  return spans
    .filter((s) => s.end + DAY > min && s.start < max)
    .map((s) => {
      const from = Math.max(s.start, min);
      const to = Math.min(s.end + DAY, max);
      const left = Math.min(((from - min) / total) * 100, 100 - MIN_BAR_PERCENT);
      const width = Math.min(Math.max(((to - from) / total) * 100, MIN_BAR_PERCENT), 100 - left);
      return { ...s, left, width, dates: s.start === s.end ? formatDay(s.start) : `${formatDay(s.start)} to ${formatDay(s.end)}` };
    });
}

/** A label on the time axis, placed in percent of its width. */
export interface AxisTick {
  left: number;
  label: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Labels for an axis from `min` to `max`: years for the whole war, months for a year or two, and days when zoomed in close.
 * About a dozen at most, so they never crowd.
 */
export function axisTicks(min: number, max: number): AxisTick[] {
  const span = max - min;
  const at = (t: number, label: string): AxisTick => ({ left: ((t - min) / span) * 100, label });
  const ticks: AxisTick[] = [];
  if (span > 1200 * DAY) {
    for (let year = new Date(min).getUTCFullYear() + 1; Date.UTC(year, 0, 1) < max; year++) {
      ticks.push(at(Date.UTC(year, 0, 1), String(year)));
    }
  } else if (span > 100 * DAY) {
    const months = span > 790 * DAY ? 3 : span > 420 * DAY ? 2 : 1;
    const first = new Date(min);
    for (let m = first.getUTCMonth() + 1; ; m++) {
      const t = Date.UTC(first.getUTCFullYear(), m, 1);
      if (t >= max) {
        break;
      }
      if (m % months === 0) {
        const d = new Date(t);
        ticks.push(at(t, `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`));
      }
    }
  } else {
    const days = [1, 2, 5, 7, 14].find((d) => span / (d * DAY) <= 14) ?? 14;
    for (let t = Math.ceil(min / (days * DAY)) * days * DAY; t < max; t += days * DAY) {
      const d = new Date(t);
      ticks.push(at(t, `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`));
    }
  }
  return ticks;
}

/** What the map has open, told to the timeline so its operation list can show where the incident sits in time. */
export interface TimelineFocus {
  /** The incident's date and time as recorded. */
  date: string;
  /** The operation the incident belongs to, when it has one. */
  operation: string | null;
}

/** The stretch of time is never narrower than this, or a one-day operation would fill the screen. */
const MIN_FOCUS_WINDOW = 14 * DAY;

/**
 * The stretch of time the operation list shows for an incident: its operation from its first contact to its last, with a
 * margin so the ends can be seen; or, for an incident with no operation, a couple of months round its date.
 */
export function focusWindow(focus: TimelineFocus, spans: readonly OperationSpan[], min: number, max: number): ZoomRange {
  const day = dayMs(focus.date);
  const span = focus.operation ? spans.find((s) => s.name === focus.operation) : undefined;
  let start = span ? Math.min(span.start, day) : day - 30 * DAY;
  let end = (span ? Math.max(span.end, day) : day + 30 * DAY) + DAY;
  const margin = Math.max((end - start) * 0.1, 7 * DAY);
  start -= margin;
  end += margin;
  if (end - start < MIN_FOCUS_WINDOW) {
    const middle = (start + end) / 2;
    start = middle - MIN_FOCUS_WINDOW / 2;
    end = middle + MIN_FOCUS_WINDOW / 2;
  }
  // Near an end of the timeline the window slides inward rather than shrink, so it keeps its width.
  if (end - start >= max - min) {
    return { start: min, end: max };
  }
  if (start < min) {
    end += min - start;
    start = min;
  }
  if (end > max) {
    start -= end - max;
    end = max;
  }
  return { start, end };
}

/** A drag across the bars shorter than this many pixels is a click, not a choice of dates. */
export const MIN_DRAG_PX = 6;

/**
 * The dates a drag across the bar chart picks. `fromX` and `toX` are pixels across the chart, `width` its width, and `extent`
 * the stretch of time the chart shows now, over the plot area inside its margins. The dates are whole days, at least one.
 */
export function dragRange(fromX: number, toX: number, width: number, extent: ZoomRange): ZoomRange | null {
  const inner = width - CHART_GRID.left - CHART_GRID.right;
  if (inner <= 0) {
    return null;
  }
  const timeAt = (x: number) => extent.start + Math.min(Math.max((x - CHART_GRID.left) / inner, 0), 1) * (extent.end - extent.start);
  const start = Math.floor(Math.min(timeAt(fromX), timeAt(toX)) / DAY) * DAY;
  const end = Math.max(Math.ceil(Math.max(timeAt(fromX), timeAt(toX)) / DAY) * DAY, start + DAY);
  return { start, end };
}

let nextTimelineId = 0;

/**
 * The strip along the bottom of the map: contacts per month, with a slider that sets the date filter. Play moves a window of
 * time along the timeline so the map shows the war unfolding. Dragging across the bars picks the dates directly, and "Reset
 * zoom" goes back to the whole war.
 *
 * An arrow at the centre of its top edge opens the operation timeline above it: a Gantt chart with one row for each operation,
 * on the same time axis as the bar chart, drawn from the operation's first contact to its last. It lists only the operations
 * that have contacts left by the filters. Clicking a row chooses that operation as a filter and clicking it again takes it
 * off; any number can be chosen. The two always show the same stretch of time: normally the date filter, or, while an
 * incident is open, the window zoomed to that incident's operation (the date filter itself is untouched, and the bar chart
 * goes back to it when the incident is closed). Only the bar chart carries date labels; a red line marks the open incident's
 * date, running the full height of both.
 */
@Component({
  selector: 'app-timeline',
  imports: [EChart, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="tl" aria-label="Timeline">
      <button
        type="button"
        class="tl__toggle"
        [attr.aria-expanded]="expanded()"
        [attr.aria-controls]="opsId"
        [attr.aria-label]="expanded() ? 'Hide the operation timeline' : 'Show the operation timeline'"
        (click)="expanded.set(!expanded())"
      >
        <span class="tl__arrow" aria-hidden="true"></span>
      </button>

      <div class="tl__ops" [id]="opsId" role="region" aria-label="Operation timeline" [class.is-open]="expanded()">
        <div #scroller class="tl__scroll">
          <div class="axis" aria-hidden="true">
            <div class="axis__side">Operations</div>
            <div class="axis__plot">
              <!-- The date labels are only on the bar chart below, so they are not said twice. -->
              @if (marker(); as m) {
                <span class="axis__marker" [class.is-right]="m.left > 65" [style.left.%]="m.left">{{ m.label }}</span>
              }
            </div>
          </div>
          @if (rows().length) {
            <div
              class="gantt"
              role="listbox"
              aria-multiselectable="true"
              aria-label="Operations. Choose any number to show only their contacts."
              tabindex="0"
              [attr.aria-activedescendant]="rowId(activeRow())"
              (keydown)="onKeydown($event)"
            >
              <div class="gantt__plot" aria-hidden="true">
                @for (t of ticks(); track t.left) {
                  <i class="gantt__grid" [style.left.%]="t.left"></i>
                }
              </div>
              @for (row of rows(); track row.name; let i = $index) {
                <div
                  class="row"
                  role="option"
                  [id]="rowId(i)"
                  [attr.aria-selected]="selectedOperations().has(row.name)"
                  [class.is-on]="selectedOperations().has(row.name)"
                  [class.is-active]="i === activeRow()"
                  [class.is-focus]="i === focusRow()"
                  [attr.title]="row.name + ': ' + row.dates + ' (' + row.count + (row.count === 1 ? ' contact' : ' contacts') + ')'"
                  (click)="pick(i)"
                >
                  <span class="row__name">{{ row.name }}<span class="visually-hidden">, {{ row.dates }}</span></span>
                  <span class="row__track"><span class="row__bar" [style.left.%]="row.left" [style.width.%]="row.width" [style.background]="operationColours()?.get(row.op) ?? null"></span></span>
                </div>
              }
            </div>
          } @else {
            <p class="tl__none">{{ operations().length ? 'No operation has contacts that match the filters in this stretch of time.' : 'No operations are recorded.' }}</p>
          }
        </div>
      </div>

      <div class="tl__strip">
        <div class="tl__controls">
          <!-- Play, with its speed on a split button beside it; the menu shuts when focus leaves the pair. -->
          <div class="tl__split" (focusout)="speedBlur($event)" (keydown.escape)="closeSpeedMenu(true)">
            <button type="button" class="tl__play" [attr.aria-pressed]="playing()" (click)="togglePlay()"><app-icon [name]="playing() ? 'pause' : 'play'" />{{ playing() ? 'Pause' : 'Play' }}</button>
            <button
              #speedButton
              type="button"
              class="tl__speed"
              aria-label="Playback speed"
              aria-haspopup="menu"
              [attr.aria-controls]="speedMenuId"
              [attr.aria-expanded]="speedMenu()"
              (click)="speedMenu() ? closeSpeedMenu(false) : openSpeedMenu()"
            >
              <app-icon name="settings" />
            </button>
            @if (speedMenu()) {
              <div #speedList class="tl__menu" role="menu" aria-label="Playback speed" [id]="speedMenuId" (keydown)="speedKey($event)">
                @for (s of speeds; track s.id) {
                  <button type="button" role="menuitemradio" class="tl__speed-item" [attr.aria-checked]="speed() === s.id" tabindex="-1" (click)="chooseSpeed(s.id)">
                    <app-icon name="check" class="tl__tick" [class.is-on]="speed() === s.id" />{{ s.name }}
                  </button>
                }
              </div>
            }
          </div>
          <span class="tl__range" aria-live="polite">@if (ends(); as e) {<span class="tl__date">{{ e.from }}</span> to <span class="tl__date">{{ e.to }}</span>} @else {The whole war}</span>
          @if (range().from || range().to) {
            <button type="button" class="tl__reset" (click)="reset()"><app-icon name="zoom-out" />Reset zoom</button>
          } @else {
            <span class="tl__hint">Drag across the bars to zoom</span>
          }
        </div>
        <div
          class="tl__chart"
          (pointerdown)="dragStart($event)"
          (pointermove)="dragMove($event)"
          (pointerup)="dragEnd($event)"
          (pointercancel)="dragEnd($event)"
        >
          <app-echart [option]="option()" (zoomed)="zoomed($event)" />
          <!-- The dates at the slider's handles, following them as they move. -->
          @for (h of handles(); track h.side) {
            <span class="tl__handle" [class.tl__handle--start]="h.side === 'start'" [class.tl__handle--end]="h.side === 'end'" [class.is-inside]="h.inside" [style.left]="h.left" aria-hidden="true">{{ h.text }}</span>
          }
          @if (dragBox(); as box) {
            <div class="tl__drag" [style.left.px]="box.left" [style.width.px]="box.width"></div>
          }
        </div>
      </div>

      <!-- The open incident's date, drawn over both charts (not just the operation list), so it reads as one line down to the bar chart. -->
      @if (marker(); as m) {
        <div class="tl__plot" aria-hidden="true">
          <i class="tl__marker" [style.left.%]="m.left"></i>
        </div>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .tl {
      /* The width of the column at the left, shared by the controls and the operation names so both charts start together. */
      --tl-side: 11rem;
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      background: rgb(31 35 20 / 0.94);
      border-top: 2px solid var(--brass);
      color: var(--paper);
    }

    /* The arrow tab on the top edge, at the centre. */
    .tl__toggle {
      position: absolute;
      z-index: 2;
      top: -2px;
      left: 50%;
      display: grid;
      place-content: center;
      width: 3.4rem;
      height: 1.2rem;
      padding: 0;
      color: var(--ink);
      background: var(--brass);
      border: 0;
      border-radius: 6px 6px 0 0;
      transform: translate(-50%, -100%);
      cursor: pointer;
    }
    .tl__toggle:hover {
      background: var(--smoke-yellow);
    }
    .tl__arrow {
      width: 0.55rem;
      height: 0.55rem;
      border: solid currentcolor;
      border-width: 2px 0 0 2px;
      transform: translateY(2px) rotate(45deg);
      transition: transform 0.25s ease;
    }
    .tl__toggle[aria-expanded='true'] .tl__arrow {
      transform: translateY(-2px) rotate(225deg);
    }

    /* The operation timeline takes whatever height the map gives the timeline above the strip. */
    .tl__ops {
      flex: 1 1 0;
      min-height: 0;
      overflow: hidden;
      visibility: hidden;
      transition: visibility 0s linear 0.25s;
    }
    .tl__ops.is-open {
      visibility: visible;
      transition: visibility 0s;
    }
    .tl__scroll {
      height: 100%;
      overflow-y: auto;
      scroll-padding-top: 1.7rem;
    }
    .tl__none {
      margin: 1rem 0.75rem;
      color: var(--khaki);
    }

    .axis {
      position: sticky;
      z-index: 1;
      top: 0;
      display: flex;
      height: 1.5rem;
      padding: 0 0.75rem;
      color: var(--khaki);
      font-variant-numeric: tabular-nums;
      font-size: 0.75rem;
      background: rgb(31 35 20);
      border-bottom: 1px solid var(--olive-700);
    }
    .axis__side {
      flex: none;
      width: calc(var(--tl-side) + 0.75rem);
      align-self: center;
      color: var(--brass);
      font-family: var(--font-display);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    /* The plot is inset like the bar chart's, so a date is at the same place in both. */
    .axis__plot {
      position: relative;
      flex: 1;
      margin: 0 12px 0 8px;
    }
    /* The date of the incident that is open, flagged on the axis; the line itself runs the full height of the timeline (see .tl__marker). */
    .axis__marker {
      position: absolute;
      font-family: var(--font-data);
      z-index: 1;
      top: 0;
      bottom: 0;
      padding: 0 5px;
      color: var(--ink);
      font-weight: 700;
      line-height: 1.5rem;
      white-space: nowrap;
      background: var(--smoke-yellow);
      border-radius: 2px;
      transform: translateX(-2px);
    }
    .axis__marker.is-right {
      transform: translateX(calc(-100% + 2px));
    }

    .gantt {
      position: relative;
      outline-offset: -2px;
    }
    .gantt__plot {
      position: absolute;
      top: 0;
      right: calc(0.75rem + 12px);
      bottom: 0;
      left: calc(0.75rem + var(--tl-side) + 0.75rem + 8px);
      pointer-events: none;
    }
    .gantt__grid {
      position: absolute;
      top: 0;
      bottom: 0;
      border-left: 1px solid rgb(230 221 184 / 0.1);
    }

    .row {
      display: flex;
      align-items: center;
      height: 1.4rem;
      padding: 0 0.75rem;
      cursor: pointer;
    }
    .row:hover {
      background: rgb(230 221 184 / 0.08);
    }
    .row.is-on {
      background: rgb(227 185 46 / 0.16);
    }
    /* The operation of the incident that is open. */
    .row.is-focus {
      box-shadow: inset 3px 0 0 var(--smoke-yellow);
    }
    .row.is-focus .row__name {
      color: var(--paper);
      font-weight: 700;
    }
    .gantt:focus-visible .row.is-active {
      outline: 2px solid var(--smoke-yellow);
      outline-offset: -2px;
    }
    .row__name {
      flex: none;
      width: calc(var(--tl-side) + 0.75rem);
      padding-right: 0.6rem;
      overflow: hidden;
      color: var(--khaki);
      font-size: 0.75rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row.is-on .row__name {
      color: var(--smoke-yellow);
      font-weight: 700;
    }
    .row__track {
      position: relative;
      flex: 1;
      align-self: stretch;
      margin: 0 12px 0 8px;
    }
    /* The bars glide as the stretch of time changes, so the eye can follow the zoom. */
    .row__bar {
      position: absolute;
      top: 50%;
      min-width: 3px;
      height: 0.6rem;
      margin-top: -0.3rem;
      background: rgb(230 221 184 / 0.75);
      border-radius: 1px;
      transition:
        left 0.35s ease,
        width 0.35s ease;
    }
    .row:hover .row__bar {
      background: var(--khaki);
    }
    .row.is-on .row__bar {
      background: var(--smoke-yellow);
      box-shadow: 0 0 0 1px var(--ink);
    }

    .tl__strip {
      display: flex;
      flex: none;
      align-items: stretch;
      gap: 0.75rem;
      height: calc(9rem - 2px);
      padding: 0.4rem 0.75rem;
    }
    .tl__controls {
      display: flex;
      flex: none;
      flex-direction: column;
      justify-content: center;
      gap: 0.3rem;
      width: var(--tl-side);
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
    .tl__split {
      position: relative;
      display: flex;
    }
    .tl__split .tl__play {
      flex: 1;
      border-right-color: color-mix(in srgb, var(--ink) 35%, var(--brass));
    }
    .tl__speed {
      display: inline-grid;
      place-items: center;
      padding: 0 0.45rem;
      color: var(--ink);
      background: var(--brass);
      border: 1px solid var(--brass);
      border-left: 0;
      cursor: pointer;
    }
    .tl__speed app-icon,
    .tl__tick {
      margin: 0;
    }
    /* Opens upwards: the strip sits at the foot of the screen. */
    .tl__menu {
      position: absolute;
      z-index: 2;
      bottom: calc(100% + 0.25rem);
      right: 0;
      display: flex;
      flex-direction: column;
      min-width: 8rem;
      padding: 0.25rem 0;
      background: var(--olive-900);
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    }
    .tl__speed-item {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.75rem;
      color: var(--paper);
      font: inherit;
      font-size: 0.85rem;
      text-align: left;
      background: none;
      border: 0;
      cursor: pointer;
    }
    .tl__speed-item:hover,
    .tl__speed-item:focus-visible {
      background: var(--olive-700);
      outline: none;
    }
    .tl__tick {
      visibility: hidden;
      color: var(--smoke-yellow);
    }
    .tl__tick.is-on {
      visibility: visible;
    }
    /* Centred under Play. Two dates and " to " fit the column on one line; should they not, the second goes under the first, never broken. */
    .tl__range {
      font-family: var(--font-data);
      font-size: 0.75rem;
      text-align: center;
      color: var(--khaki);
    }
    .tl__date {
      white-space: nowrap;
    }
    .tl__hint {
      color: var(--khaki);
      font-size: 0.72rem;
      opacity: 0.8;
    }
    .tl__chart {
      position: relative;
      flex: 1;
      min-width: 0;
      touch-action: none;
    }
    /* A date at one of the slider's handles: outside the window, or inside it near an end of the timeline. */
    .tl__handle {
      position: absolute;
      bottom: 4px;
      height: 36px;
      line-height: 36px;
      padding-inline: 6px;
      font-family: var(--font-data);
      font-size: 0.75rem;
      color: var(--paper);
      white-space: nowrap;
      pointer-events: none;
    }
    .tl__handle--start {
      transform: translateX(-100%);
    }
    .tl__handle--start.is-inside,
    .tl__handle--end {
      transform: none;
    }
    .tl__handle--end.is-inside {
      transform: translateX(-100%);
    }
    /* The dates being picked by a drag across the bars. */
    .tl__drag {
      position: absolute;
      top: 6px;
      bottom: 62px;
      background: rgb(227 185 46 / 0.22);
      border-inline: 1px solid var(--smoke-yellow);
      pointer-events: none;
    }
    /* Inset the same way as the bar chart and the operation list's own plot, so a date sits at the same place in all three. */
    .tl__plot {
      position: absolute;
      z-index: 2;
      top: 0;
      right: calc(0.75rem + 12px);
      bottom: 0;
      left: calc(0.75rem + var(--tl-side) + 0.75rem + 8px);
      pointer-events: none;
    }
    /* The open incident's date, in the colour of its marker on the map, running the full height of the timeline. */
    .tl__marker {
      position: absolute;
      top: 0;
      bottom: 0;
      border-left: 2px solid var(--contact-red);
    }
    @media (prefers-reduced-motion: reduce) {
      .tl__arrow,
      .tl__ops,
      .tl__ops.is-open,
      .row__bar {
        transition: none;
      }
    }
  `,
})
export class Timeline implements OnDestroy {
  readonly all = input.required<readonly Contact[]>();
  readonly visible = input.required<readonly Contact[]>();
  readonly from = input<string | null>(null);
  readonly to = input<string | null>(null);
  /** Every operation, in the order that a contact's 1-based `op` indexes. */
  readonly operations = input<readonly { name: string }[]>([]);
  /**
   * The contacts the operation list is drawn from: those that pass the filters other than the operation choice itself (or no
   * other operation could ever be added) and the dates (the list has its own axis). `null` means every contact.
   */
  readonly scope = input<readonly Contact[] | null>(null);
  /** The operations chosen as a filter. */
  readonly selectedOperations = input<ReadonlySet<string>>(new Set());
  /** The incident that is open, if any: the operation list zooms to it. */
  readonly focus = input<TimelineFocus | null>(null);
  /** Each operation's colour, when the map's markers are coloured by operation, so its bar here is the same colour; `null` leaves the bars plain. */
  readonly operationColours = input<ReadonlyMap<number, string> | null>(null);
  /** Whether the operation timeline is open above the strip. */
  readonly expanded = model(false);
  /** Whether play is moving the window along. */
  readonly playing = model(false);
  readonly rangeChange = output<DateRange>();
  /** An operation was clicked: choose it as a filter, or take it off again. */
  readonly operationToggled = output<string>();

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  protected readonly opsId = `tl-ops-${nextTimelineId++}`;
  /** The dates being picked by a drag across the bars: where it is across the chart, in pixels. */
  protected readonly dragBox = signal<{ left: number; width: number } | null>(null);
  private dragFrom: number | null = null;
  /** The row the keyboard is on; Space or Enter chooses it. */
  private readonly active = signal(0);
  private timer?: ReturnType<typeof setInterval>;
  protected readonly speeds = PLAY_SPEEDS;
  /** How fast play goes; a change while playing takes effect at the next step. */
  protected readonly speed = signal<PlaySpeed>(DEFAULT_PLAY_SPEED);
  protected readonly speedMenu = signal(false);
  protected readonly speedMenuId = `tl-speed-${nextTimelineId++}`;
  private readonly speedButton = viewChild<ElementRef<HTMLButtonElement>>('speedButton');
  private readonly speedList = viewChild<ElementRef<HTMLElement>>('speedList');
  private readonly injector = inject(Injector);

  /** The whole span of the timeline, always by calendar month: what decides the axis and the slider's overview, whatever the bars are bucketed by. */
  private readonly monthlyBuckets = computed(() => monthBuckets(this.all(), this.visible()));
  private readonly axis = computed(() => limits(this.monthlyBuckets()));
  /**
   * The bars: bucketed finely enough to suit the stretch of time the chart is zoomed to (never finer than an hour, and
   * never so fine that the whole timeline would need more than {@link MAX_TOTAL_BUCKETS} of them), or by calendar month
   * once that stretch is wide enough that finer bars would just crowd the chart. Always spans the whole timeline, like
   * `monthlyBuckets`, so the slider's overview still shows the whole war.
   */
  private readonly buckets = computed(() => {
    const axis = this.axis();
    const view = this.view();
    const ms = axis && view ? bucketIntervalMs(view.end - view.start, axis.max - axis.min) : null;
    return axis && ms ? intervalBuckets(this.all(), this.visible(), axis.min, axis.max, ms) : this.monthlyBuckets();
  });
  /** The stretch of time the date filter picks, and both charts show. */
  private readonly extent = computed(() => {
    const axis = this.axis();
    return axis ? rangeToZoom({ from: this.from(), to: this.to() }, axis.min, axis.max) : null;
  });
  private readonly allSpans = computed(() => operationSpans(this.all(), this.operations()));
  private readonly scopedSpans = computed(() => {
    const scope = this.scope();
    return scope ? operationSpans(scope, this.operations()) : this.allSpans();
  });
  /** What the operation list shows: the dates, or for an open incident the period of its operation. */
  private readonly view = computed(() => {
    const axis = this.axis();
    const extent = this.extent();
    const focus = this.focus();
    if (!axis || !extent) {
      return null;
    }
    return focus ? focusWindow(focus, this.allSpans(), axis.min, axis.max) : extent;
  });

  // The bar chart always shows the same stretch of time as the operation list above it (`view`), so the two never disagree,
  // whether that stretch is the plain date filter or, while an incident is open, the window zoomed to its operation.
  protected readonly option = computed(() => timelineOption(this.buckets(), { from: this.from(), to: this.to() }, this.view() ?? undefined));
  protected readonly rows = computed(() => {
    const view = this.view();
    return view ? ganttRows(this.scopedSpans(), view.start, view.end) : [];
  });
  protected readonly ticks = computed(() => {
    const view = this.view();
    return view ? axisTicks(view.start, view.end) : [];
  });
  /** Where the open incident falls on the operation list's axis, when it falls on it. */
  protected readonly marker = computed(() => {
    const view = this.view();
    const focus = this.focus();
    if (!view || !focus) {
      return null;
    }
    const left = ((dayMs(focus.date) + DAY / 2 - view.start) / (view.end - view.start)) * 100;
    return left < 0 || left > 100 ? null : { left, label: `Incident ${formatDtg(focus.date)}` };
  });
  /** The row of the open incident's operation, or -1. */
  protected readonly focusRow = computed(() => {
    const operation = this.focus()?.operation;
    return operation ? this.rows().findIndex((r) => r.name === operation) : -1;
  });
  protected readonly activeRow = computed(() => Math.min(this.active(), Math.max(this.rows().length - 1, 0)));
  /** Where the slider's handles are while they are being moved, before the dates they show are applied. */
  private readonly moving = signal<ZoomRange | null>(null);
  private settleTimer?: ReturnType<typeof setTimeout>;
  /** The dates shown: those the handles are on while they move, otherwise the date filter's. */
  protected readonly range = computed<DateRange>(() => {
    const moving = this.moving();
    const axis = this.axis();
    return moving && axis ? zoomToRange(moving, axis.min, axis.max) : { from: this.from(), to: this.to() };
  });
  /** The ends of the dates shown, or null for the whole war. */
  protected readonly ends = computed(() => {
    const { from, to } = this.range();
    return from || to ? { from: from ?? 'the start', to: to ?? 'the end' } : null;
  });
  /** The dates beside the slider's handles, where a side is set (an open side sits at the end of the timeline, and needs none). */
  protected readonly handles = computed(() => {
    const axis = this.axis();
    const { from, to } = this.range();
    if (!axis) return [];
    const at = (ms: number) => Math.min(Math.max((ms - axis.min) / (axis.max - axis.min), 0), 1);
    const left = (share: number) => `calc(${CHART_GRID.left}px + (100% - ${CHART_GRID.left + CHART_GRID.right}px) * ${share})`;
    const handles: { side: 'start' | 'end'; text: string; left: string; inside: boolean }[] = [];
    if (from) {
      const share = at(dayMs(from));
      handles.push({ side: 'start', text: from, left: left(share), inside: share < LABEL_INSIDE_WITHIN });
    }
    if (to) {
      const share = at(dayMs(to) + DAY);
      handles.push({ side: 'end', text: to, left: left(share), inside: share > 1 - LABEL_INSIDE_WITHIN });
    }
    return handles;
  });

  constructor() {
    // The keyboard starts from the incident's operation.
    effect(() => {
      const row = this.focusRow();
      if (row >= 0) {
        untracked(() => this.active.set(row));
      }
    });
    // Scroll the list so that operation is in the middle. Opening the list scrolls it too, since a closed list has no height to scroll in.
    afterRenderEffect(() => {
      const row = this.focusRow();
      this.expanded();
      const scroller = this.scroller()?.nativeElement;
      const element = row >= 0 ? document.getElementById(this.rowId(row)) : null;
      if (scroller && element) {
        const box = scroller.getBoundingClientRect();
        const at = element.getBoundingClientRect();
        scroller.scrollTop += at.top - box.top - (box.height - at.height) / 2;
      }
    });
  }

  protected rowId(index: number): string {
    return `${this.opsId}-row-${index}`;
  }

  /** A click on a row chooses its operation, or takes it off again. */
  protected pick(index: number): void {
    this.active.set(index);
    this.operationToggled.emit(this.rows()[index].name);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const last = this.rows().length - 1;
    const go = (to: number) => {
      event.preventDefault();
      const index = Math.min(Math.max(to, 0), last);
      this.active.set(index);
      document.getElementById(this.rowId(index))?.scrollIntoView?.({ block: 'nearest' });
    };
    const now = this.activeRow();
    switch (event.key) {
      case 'ArrowDown':
        return go(now + 1);
      case 'ArrowUp':
        return go(now - 1);
      case 'PageDown':
        return go(now + 8);
      case 'PageUp':
        return go(now - 8);
      case 'Home':
        return go(0);
      case 'End':
        return go(last);
      case 'Enter':
      case ' ':
        event.preventDefault();
        return this.pick(now);
    }
  }

  /** The pointer went down over the bars: a drag from here picks the dates. The slider below has its own handles. */
  protected dragStart(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    const box = target.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const inPlot = x >= CHART_GRID.left && x <= box.width - CHART_GRID.right && y >= CHART_GRID.top && y <= box.height - CHART_GRID.bottom;
    if (event.button !== 0 || !inPlot || !this.extent()) {
      return;
    }
    this.dragFrom = x;
    target.setPointerCapture?.(event.pointerId);
    this.dragBox.set({ left: x, width: 0 });
  }

  protected dragMove(event: PointerEvent): void {
    if (this.dragFrom === null) {
      return;
    }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - box.left, CHART_GRID.left), box.width - CHART_GRID.right);
    this.dragBox.set({ left: Math.min(this.dragFrom, x), width: Math.abs(x - this.dragFrom) });
  }

  /** The pointer came up: a long enough drag sets the date filter to the dates it spanned. */
  protected dragEnd(event: PointerEvent): void {
    if (this.dragFrom === null) {
      return;
    }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const from = this.dragFrom;
    const to = Math.min(Math.max(event.clientX - box.left, CHART_GRID.left), box.width - CHART_GRID.right);
    this.dragFrom = null;
    this.dragBox.set(null);
    const extent = this.extent();
    const axis = this.axis();
    if (event.type === 'pointercancel' || Math.abs(to - from) < MIN_DRAG_PX || !extent || !axis) {
      return;
    }
    const range = dragRange(from, to, box.width, extent);
    if (range) {
      this.stop();
      this.rangeChange.emit(zoomToRange(range, axis.min, axis.max));
    }
  }

  /**
   * The slider's handles moved: the dates they are on show at once (beside the handles and above), and are applied to the map once
   * the handles have been still for a moment, not on every pixel of a drag.
   */
  protected zoomed(zoom: ZoomRange): void {
    const lim = this.axis();
    if (!lim) return;
    this.stop();
    this.moving.set(zoom);
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.moving.set(null);
      this.rangeChange.emit(zoomToRange(zoom, lim.min, lim.max));
    }, ZOOM_SETTLE_MS);
  }

  protected reset(): void {
    this.stop();
    clearTimeout(this.settleTimer);
    this.moving.set(null);
    this.rangeChange.emit({ from: null, to: null });
  }

  protected togglePlay(): void {
    if (this.playing()) {
      this.stop();
      return;
    }
    const lim = this.axis();
    if (!lim) {
      return;
    }
    this.playing.set(true);
    this.timer = setInterval(() => {
      const next = nextWindow({ from: this.from(), to: this.to() }, lim.min, lim.max, playDays(this.speed()));
      if (next) {
        this.rangeChange.emit(next);
      } else {
        this.stop();
      }
    }, PLAY_INTERVAL_MS);
  }

  /** Opens the speed menu with the chosen speed under the keyboard, as a menu button does. */
  protected openSpeedMenu(): void {
    this.speedMenu.set(true);
    afterNextRender(() => this.speedItems()[PLAY_SPEEDS.findIndex((s) => s.id === this.speed())]?.focus(), { injector: this.injector });
  }

  /** Shuts the menu; `refocus` puts the keyboard back on its button (after Escape or a choice), not when focus has gone elsewhere. */
  protected closeSpeedMenu(refocus: boolean): void {
    if (!this.speedMenu()) {
      return;
    }
    this.speedMenu.set(false);
    if (refocus) {
      this.speedButton()?.nativeElement.focus();
    }
  }

  protected chooseSpeed(speed: PlaySpeed): void {
    this.speed.set(speed);
    this.closeSpeedMenu(true);
  }

  /** Up and Down move through the speeds, round at the ends; Home and End go to the first and last. */
  protected speedKey(event: KeyboardEvent): void {
    const items = this.speedItems();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const to = ({ ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[event.key];
    if (to === undefined) {
      return;
    }
    event.preventDefault();
    items[(to + items.length) % items.length]?.focus();
  }

  protected speedBlur(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as HTMLElement).contains(next)) {
      this.closeSpeedMenu(false);
    }
  }

  private speedItems(): HTMLButtonElement[] {
    return [...(this.speedList()?.nativeElement.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])];
  }

  private stop(): void {
    clearInterval(this.timer);
    this.playing.set(false);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    clearTimeout(this.settleTimer);
  }
}
