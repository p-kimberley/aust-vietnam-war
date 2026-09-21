import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterRenderEffect,
  computed,
  effect,
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

const DAY = 24 * 3600 * 1000;

/** The margins round the bars inside the chart's box, in pixels. A drag across the bars is measured against them. */
export const CHART_GRID = { left: 8, right: 12, top: 6, bottom: 62 } as const;

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
    grid: { ...CHART_GRID, containLabel: false },
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

/** When an operation ran: from the day of its first contact to the day of its last. */
export interface OperationSpan {
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
      spans.set(c.op, { name: operations[c.op - 1].name, start: day, end: day, count: 1 });
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
 * zoom" goes back to the whole war. The date filter is the stretch of time both charts show.
 *
 * An arrow at the centre of its top edge opens the operation timeline above it: a Gantt chart with one row for each operation,
 * on the same time axis as the bar chart, drawn from the operation's first contact to its last. It lists only the operations
 * that have contacts left by the filters. Clicking a row chooses that operation as a filter and clicking it again takes it
 * off; any number can be chosen. While an incident is open, the list zooms to that incident's operation and marks the date of
 * the incident, and goes back when it is closed.
 */
@Component({
  selector: 'app-timeline',
  imports: [EChart],
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
              @for (t of ticks(); track t.left) {
                <span class="axis__tick" [style.left.%]="t.left">{{ t.label }}</span>
              }
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
                @if (marker(); as m) {
                  <i class="gantt__marker" [style.left.%]="m.left"></i>
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
                  <span class="row__track"><span class="row__bar" [style.left.%]="row.left" [style.width.%]="row.width"></span></span>
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
          <button type="button" class="tl__play" [attr.aria-pressed]="playing()" (click)="togglePlay()">{{ playing() ? 'Pause' : 'Play' }}</button>
          <span class="tl__range data" aria-live="polite">{{ label() }}</span>
          @if (from() || to()) {
            <button type="button" class="tl__reset" (click)="reset()">Reset zoom</button>
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
          @if (dragBox(); as box) {
            <div class="tl__drag" [style.left.px]="box.left" [style.width.px]="box.width"></div>
          }
        </div>
      </div>
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
      font-family: var(--font-data);
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
    .axis__tick {
      position: absolute;
      top: 0;
      bottom: 0;
      padding-left: 4px;
      border-left: 1px solid var(--olive-500);
      line-height: 1.5rem;
      white-space: nowrap;
    }
    /* The date of the incident that is open, flagged on the axis and drawn as a line down the list. */
    .axis__marker {
      position: absolute;
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
    .gantt__marker {
      position: absolute;
      z-index: 1;
      top: 0;
      bottom: 0;
      border-left: 2px solid var(--smoke-yellow);
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
    /* Two dates of ten characters and " to " fit the column on one line, so a date is never broken in the middle. */
    .tl__range {
      font-size: 0.74rem;
      white-space: nowrap;
      color: var(--khaki);
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
    /* The dates being picked by a drag across the bars. */
    .tl__drag {
      position: absolute;
      top: 6px;
      bottom: 62px;
      background: rgb(227 185 46 / 0.22);
      border-inline: 1px solid var(--smoke-yellow);
      pointer-events: none;
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

  private readonly buckets = computed(() => monthBuckets(this.all(), this.visible()));
  private readonly axis = computed(() => limits(this.buckets()));
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

  protected readonly option = computed(() => timelineOption(this.buckets(), { from: this.from(), to: this.to() }));
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
  protected readonly label = computed(() => {
    const from = this.from();
    const to = this.to();
    return from || to ? `${from ?? 'the start'} to ${to ?? 'the end'}` : 'The whole war';
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
