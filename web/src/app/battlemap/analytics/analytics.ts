import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type ChartShape = 'Area' | 'StackedArea' | 'Line' | 'Bar' | 'StackedBar';
export type XKind = 'Time' | 'Hour' | 'Value' | 'Category';
export type ChartGroup = 'Casualties' | 'Frequency' | 'Weapons' | 'Personnel';

/** One chart the API can draw. Personnel charts ignore the map's filters. */
export interface ChartInfo {
  id: string;
  title: string;
  group: ChartGroup;
  description: string;
  usesFilter: boolean;
}

export interface ChartSeries {
  name: string;
  /** `[x, y]` pairs. For a category axis, x is the position in `categories`. Times are UTC midnight in milliseconds. */
  points: [number, number][];
}

/** Mirrors the API's `ChartResult`: everything a chart needs to draw itself. */
export interface ChartResult {
  id: string;
  title: string;
  shape: ChartShape;
  x: XKind;
  xLabel: string;
  yLabel: string;
  categories: string[] | null;
  series: ChartSeries[];
  rows: number;
  note: string | null;
}

export const GROUP_LABEL: Record<ChartGroup, string> = {
  Casualties: 'Casualties',
  Frequency: 'How often',
  Weapons: 'Weapons',
  Personnel: 'People (all service)',
};

/** Talks to the analytics API. Contact charts are drawn from the ids the map is showing, so they follow its filters. */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);

  charts(): Promise<ChartInfo[]> {
    return firstValueFrom(this.http.get<ChartInfo[]>('/api/analytics/charts'));
  }

  /** `ids` are the contacts to draw from; `null` means every contact. */
  draw(id: string, ids: readonly number[] | null): Promise<ChartResult> {
    return firstValueFrom(this.http.post<ChartResult>(`/api/analytics/charts/${encodeURIComponent(id)}`, { ids }));
  }
}

/** True when there is nothing to draw: no series, or series with no points. */
export function isEmpty(chart: ChartResult): boolean {
  return chart.series.every((s) => s.points.length === 0);
}

// ---------------------------------------------------------------- table

const pad = (n: number) => String(n).padStart(2, '0');

/** Formats an x value for reading: a date (or a month when every point is the first of a month), an hour, a number or a category. */
export function formatX(chart: ChartResult, x: number, monthly = isMonthly(chart)): string {
  switch (chart.x) {
    case 'Time': {
      const d = new Date(x);
      return monthly ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` : `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    case 'Hour':
      return `${pad(x)}:00`;
    case 'Category':
      return chart.categories?.[x] ?? String(x);
    default:
      return String(x);
  }
}

function isMonthly(chart: ChartResult): boolean {
  return chart.x === 'Time' && chart.series.every((s) => s.points.every(([x]) => new Date(x).getUTCDate() === 1));
}

export interface ChartTable {
  columns: string[];
  rows: string[][];
}

/** The chart's numbers as a table, for people who cannot read a picture and for anyone who wants the figures. */
export function chartTable(chart: ChartResult): ChartTable {
  const xs = [...new Set(chart.series.flatMap((s) => s.points.map(([x]) => x)))].sort((a, b) => a - b);
  const lookup = chart.series.map((s) => new Map(s.points));
  const monthly = isMonthly(chart);
  return {
    columns: [chart.xLabel, ...chart.series.map((s) => s.name)],
    rows: xs.map((x) => [formatX(chart, x, monthly), ...lookup.map((m) => (m.has(x) ? String(m.get(x)) : ''))]),
  };
}

// ---------------------------------------------------------------- drawing options

/** Colours that read on the map's dark panels. */
export interface ChartTheme {
  text: string;
  muted: string;
  grid: string;
  palette: string[];
  /** Fixed colours for series whose meaning is the same in every chart (friendly is blue, enemy is red). */
  named: Record<string, string>;
}

export const DARK: ChartTheme = {
  text: '#efe7cc',
  muted: '#b9ac80',
  grid: 'rgba(230, 221, 184, 0.16)',
  palette: ['#e3b92e', '#6fa8d6', '#d9822b', '#8fb56a', '#c9a0dc', '#e0553b', '#5fc4b8', '#b9ac80', '#f0c987'],
  named: {
    'Enemy killed': '#e0553b',
    'Enemy wounded': '#d9822b',
    'Friendly killed': '#4f8fc7',
    'Friendly wounded': '#9cc7e8',
    'Friendly fired first': '#6fa8d6',
    'Enemy fired first': '#e0553b',
    'Unknown fired first': '#b9ac80',
    Other: '#8a8466',
    Unknown: '#8a8466',
  },
};

/** The parts of an ECharts option this app builds. Typed loosely: the library's own option type is enormous. */
export type ChartOption = Record<string, unknown>;

export function seriesColour(name: string, index: number, theme: ChartTheme = DARK): string {
  return theme.named[name] ?? theme.palette[index % theme.palette.length];
}

/**
 * Turns a chart from the API into an ECharts option. Pure, so it can be tested without a browser. A time chart zooms by dragging or
 * pinching it, and also has a slider along its foot unless `slider` is false (on a phone, where the room is better spent on the chart).
 */
export function chartOption(chart: ChartResult, theme: ChartTheme = DARK, { slider = true }: { slider?: boolean } = {}): ChartOption {
  const stacked = chart.shape === 'StackedArea' || chart.shape === 'StackedBar';
  const bar = chart.shape === 'Bar' || chart.shape === 'StackedBar';
  const area = chart.shape === 'Area' || chart.shape === 'StackedArea';
  const category = chart.x === 'Category';
  const points = chart.series.reduce((n, s) => n + s.points.length, 0);
  const monthly = isMonthly(chart);

  const axisText = { color: theme.muted };
  const xAxis: ChartOption =
    chart.x === 'Time'
      ? { type: 'time', axisLabel: axisText }
      : category
        ? { type: 'category', data: chart.categories ?? [], axisLabel: { ...axisText, interval: 0, rotate: 30, width: 90, overflow: 'truncate' } }
        : chart.x === 'Hour'
          ? { type: 'value', min: 0, max: 23, interval: 3, axisLabel: { ...axisText, formatter: (v: number) => `${pad(v)}:00` } }
          : { type: 'value', axisLabel: axisText };

  return {
    aria: { enabled: true },
    animation: points < 3000,
    color: chart.series.map((s, i) => seriesColour(s.name, i, theme)),
    textStyle: { color: theme.text },
    legend: { type: 'scroll', top: 0, textStyle: { color: theme.text }, pageTextStyle: { color: theme.text } },
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: bar ? 'shadow' : 'line' },
      backgroundColor: 'rgba(31, 35, 20, 0.95)',
      borderColor: theme.grid,
      textStyle: { color: theme.text },
    },
    grid: { left: 8, right: 16, top: 44, bottom: chart.x === 'Time' && slider ? 64 : 28, containLabel: true },
    xAxis: {
      ...xAxis,
      name: chart.xLabel,
      nameLocation: 'middle',
      nameGap: category ? 60 : 30,
      nameTextStyle: { color: theme.muted },
      axisLine: { lineStyle: { color: theme.grid } },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: chart.yLabel,
      nameTextStyle: { color: theme.muted, align: 'left' },
      axisLabel: axisText,
      splitLine: { lineStyle: { color: theme.grid } },
    },
    dataZoom:
      chart.x === 'Time'
        ? [
            { type: 'inside', filterMode: 'none' },
            ...(slider ? [{ type: 'slider', height: 18, bottom: 8, filterMode: 'none', textStyle: { color: theme.muted } }] : []),
          ]
        : undefined,
    series: chart.series.map((s) => ({
      name: s.name,
      type: bar ? 'bar' : 'line',
      stack: stacked ? 'total' : undefined,
      showSymbol: !bar && s.points.length < 60,
      symbolSize: 5,
      lineStyle: bar ? undefined : { width: 2 },
      areaStyle: area ? { opacity: stacked ? 0.75 : 0.35 } : undefined,
      emphasis: { focus: 'series' },
      // A category axis takes the values alone, in category order; every other axis takes `[x, y]` pairs.
      data: category ? alignToCategories(chart, s) : s.points,
      barMaxWidth: monthly ? 24 : 40,
    })),
  };
}

function alignToCategories(chart: ChartResult, s: ChartSeries): (number | null)[] {
  const values = new Map(s.points);
  return (chart.categories ?? []).map((_, i) => values.get(i) ?? null);
}
