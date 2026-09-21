import { ChangeDetectionStrategy, Component, OnDestroy, computed, input, model, output, signal } from '@angular/core';
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

/** Places each span on an axis from `min` to `max`, the same axis as the bar chart above it. The last day counts in full. */
export function ganttRows(spans: readonly OperationSpan[], min: number, max: number): GanttRow[] {
  const total = max - min;
  return spans.map((s) => {
    const left = Math.min(Math.max(((s.start - min) / total) * 100, 0), 100 - MIN_BAR_PERCENT);
    const width = Math.min(Math.max(((s.end + DAY - s.start) / total) * 100, MIN_BAR_PERCENT), 100 - left);
    return { ...s, left, width, dates: s.start === s.end ? formatDay(s.start) : `${formatDay(s.start)} to ${formatDay(s.end)}` };
  });
}

/** Where each new year starts on the axis, for the labels and the faint lines behind the bars. */
export function yearTicks(min: number, max: number): { year: number; left: number }[] {
  const ticks: { year: number; left: number }[] = [];
  for (let year = new Date(min).getUTCFullYear() + 1; Date.UTC(year, 0, 1) < max; year++) {
    ticks.push({ year, left: ((Date.UTC(year, 0, 1) - min) / (max - min)) * 100 });
  }
  return ticks;
}

/** The stretch of the axis the date filter covers, in percent, or `null` when the whole war is shown. */
export function windowPercent(range: DateRange, min: number, max: number): { left: number; width: number } | null {
  if (range.from === null && range.to === null) {
    return null;
  }
  const zoom = rangeToZoom(range, min, max);
  const left = ((zoom.start - min) / (max - min)) * 100;
  return { left, width: ((zoom.end - zoom.start) / (max - min)) * 100 };
}

let nextTimelineId = 0;

/**
 * The strip along the bottom of the map: contacts per month, with a slider that sets the date filter. Play moves a window of
 * time along the timeline so the map shows the war unfolding.
 *
 * An arrow at the centre of its top edge opens the operation timeline above it: a Gantt chart with one row for each operation,
 * on the same time axis as the bar chart, drawn from the operation's first contact to its last. Clicking a row chooses that
 * operation as a filter and clicking it again takes it off; any number can be chosen.
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
        <div class="tl__scroll">
          <div class="axis" aria-hidden="true">
            <div class="axis__side">Operations</div>
            <div class="axis__plot">
              @for (t of ticks(); track t.year) {
                <span class="axis__tick" [style.left.%]="t.left">{{ t.year }}</span>
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
                @for (t of ticks(); track t.year) {
                  <i class="gantt__grid" [style.left.%]="t.left"></i>
                }
                @if (band(); as b) {
                  <i class="gantt__band" [style.left.%]="b.left" [style.width.%]="b.width"></i>
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
                  [attr.title]="row.name + ': ' + row.dates + ' (' + row.count + (row.count === 1 ? ' contact' : ' contacts') + ')'"
                  (click)="pick(i)"
                >
                  <span class="row__name">{{ row.name }}<span class="visually-hidden">, {{ row.dates }}</span></span>
                  <span class="row__track"><span class="row__bar" [style.left.%]="row.left" [style.width.%]="row.width"></span></span>
                </div>
              }
            </div>
          } @else {
            <p class="tl__none">No operations are recorded.</p>
          }
        </div>
      </div>

      <div class="tl__strip">
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
    /* The stretch of time the date filter has picked. */
    .gantt__band {
      position: absolute;
      top: 0;
      bottom: 0;
      background: rgb(227 185 46 / 0.13);
      border-inline: 1px solid rgb(227 185 46 / 0.5);
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
    .row__bar {
      position: absolute;
      top: 50%;
      min-width: 3px;
      height: 0.6rem;
      margin-top: -0.3rem;
      background: rgb(230 221 184 / 0.75);
      border-radius: 1px;
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
    .tl__range {
      font-size: 0.8rem;
      color: var(--khaki);
    }
    .tl__chart {
      flex: 1;
      min-width: 0;
    }
    @media (prefers-reduced-motion: reduce) {
      .tl__arrow,
      .tl__ops,
      .tl__ops.is-open {
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
  /** The operations chosen as a filter. */
  readonly selectedOperations = input<ReadonlySet<string>>(new Set());
  /** Whether the operation timeline is open above the strip. */
  readonly expanded = model(false);
  readonly rangeChange = output<DateRange>();
  /** An operation was clicked: choose it as a filter, or take it off again. */
  readonly operationToggled = output<string>();

  protected readonly opsId = `tl-ops-${nextTimelineId++}`;
  protected readonly playing = signal(false);
  /** The row the keyboard is on; Space or Enter chooses it. */
  private readonly active = signal(0);
  private timer?: ReturnType<typeof setInterval>;

  private readonly buckets = computed(() => monthBuckets(this.all(), this.visible()));
  private readonly axis = computed(() => limits(this.buckets()));
  protected readonly option = computed(() => timelineOption(this.buckets(), { from: this.from(), to: this.to() }));
  protected readonly rows = computed(() => {
    const axis = this.axis();
    return axis ? ganttRows(operationSpans(this.all(), this.operations()), axis.min, axis.max) : [];
  });
  protected readonly ticks = computed(() => {
    const axis = this.axis();
    return axis ? yearTicks(axis.min, axis.max) : [];
  });
  protected readonly band = computed(() => {
    const axis = this.axis();
    return axis ? windowPercent({ from: this.from(), to: this.to() }, axis.min, axis.max) : null;
  });
  protected readonly activeRow = computed(() => Math.min(this.active(), Math.max(this.rows().length - 1, 0)));
  protected readonly label = computed(() => {
    const from = this.from();
    const to = this.to();
    return from || to ? `${from ?? 'the start'} to ${to ?? 'the end'}` : 'The whole war';
  });

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
