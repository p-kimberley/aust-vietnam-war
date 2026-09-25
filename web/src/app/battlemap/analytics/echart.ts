import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { ECharts } from 'echarts/core';
import type { ChartOption } from './analytics';

/** The visible stretch of a time axis after the reader drags or zooms it, as UTC milliseconds. */
export interface ZoomRange {
  start: number;
  end: number;
}

type EChartsModule = typeof import('echarts/core');
let loading: Promise<EChartsModule> | undefined;

/**
 * Loads ECharts once, and only the parts this app draws with (lines, bars, axes, tooltips, zoom, accessibility text).
 * Imported on demand so the charts cost nothing until someone opens them.
 */
export function loadEcharts(): Promise<EChartsModule> {
  loading ??= (async () => {
    const [core, charts, components, renderers] = await Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers'),
    ]);
    core.use([
      charts.LineChart,
      charts.BarChart,
      components.GridComponent,
      components.TooltipComponent,
      components.LegendComponent,
      components.DataZoomComponent,
      components.AriaComponent,
      renderers.CanvasRenderer,
    ]);
    return core;
  })();
  return loading;
}

/** A drag narrower than this, in pixels, is a click, not a choice of dates. */
const MIN_SELECT_PX = 6;

/**
 * A chart. Draws `option`, follows the size of its box, reports zoom changes, and cleans up after itself. When `selectable`, a drag
 * across the plot of a time chart picks the stretch of time it spans (shown as a band while dragging) and reports it.
 */
@Component({
  selector: 'app-echart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #host
      class="host"
      [class.is-selectable]="selectable()"
      (pointerdown)="selectStart($event)"
      (pointermove)="selectMove($event)"
      (pointerup)="selectEnd($event)"
      (pointercancel)="selectEnd($event)"
    ></div>
    @if (band(); as b) {
      <div class="band" [style.left.px]="b.left" [style.width.px]="b.width" [style.top.px]="b.top" [style.height.px]="b.height"></div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      width: 100%;
      height: 100%;
    }
    .host {
      width: 100%;
      height: 100%;
    }
    .host.is-selectable {
      cursor: crosshair;
      touch-action: pan-y;
    }
    /* The stretch being picked, drawn as the timeline draws its own. */
    .band {
      position: absolute;
      background: rgb(227 185 46 / 0.22);
      border-inline: 1px solid var(--smoke-yellow);
      pointer-events: none;
    }
  `,
})
export class EChart implements OnDestroy {
  readonly option = input.required<ChartOption>();
  /** Emitted when the reader changes the zoom of a time axis. */
  readonly zoomed = output<ZoomRange>();
  /** Whether a drag across the plot picks a stretch of time (a time chart only). */
  readonly selectable = input(false);
  /** The stretch of time a drag picked, as UTC milliseconds, earliest first. */
  readonly selected = output<ZoomRange>();

  protected readonly band = signal<{ left: number; width: number; top: number; height: number } | null>(null);
  private selectFrom: number | null = null;

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly chart = signal<ECharts | null>(null);
  private observer?: ResizeObserver;
  private destroyed = false;

  constructor() {
    afterNextRender(async () => {
      const echarts = await loadEcharts();
      if (this.destroyed) {
        return;
      }
      const chart = echarts.init(this.host().nativeElement, undefined, { renderer: 'canvas' });
      chart.on('datazoom', () => {
        const zoom = (chart.getOption() as { dataZoom?: { startValue?: number; endValue?: number }[] }).dataZoom?.[0];
        if (zoom?.startValue !== undefined && zoom.endValue !== undefined) {
          this.zoomed.emit({ start: Number(zoom.startValue), end: Number(zoom.endValue) });
        }
      });
      this.observer = new ResizeObserver(() => chart.resize());
      this.observer.observe(this.host().nativeElement);
      this.chart.set(chart);
    });

    effect(() => {
      const chart = this.chart();
      const option = this.option();
      // Replace, not merge, so a different chart never inherits the previous one's series or axes.
      chart?.setOption(option as never, { notMerge: true });
    });
  }

  /**
   * The plot's box inside the chart, in pixels, or `null` before the chart is drawn. The grid lays itself out round its labels, so
   * only ECharts knows where it is (its model is not in the typings, but it is how the library itself finds the grid).
   */
  private plot(): { left: number; top: number; width: number; height: number } | null {
    type Model = { getComponent(type: string): { coordinateSystem?: { getRect(): { x: number; y: number; width: number; height: number } } } | undefined };
    const rect = (this.chart() as unknown as { getModel?(): Model } | null)?.getModel?.().getComponent('grid')?.coordinateSystem?.getRect();
    return rect ? { left: rect.x, top: rect.y, width: rect.width, height: rect.height } : null;
  }

  protected selectStart(event: PointerEvent): void {
    const plot = this.plot();
    if (!this.selectable() || !plot || event.button !== 0 || !event.isPrimary) {
      return;
    }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    if (x < plot.left || x > plot.left + plot.width || y < plot.top || y > plot.top + plot.height) {
      return;
    }
    this.selectFrom = x;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.band.set({ left: x, width: 0, top: plot.top, height: plot.height });
  }

  protected selectMove(event: PointerEvent): void {
    const plot = this.plot();
    if (this.selectFrom === null || !plot) {
      return;
    }
    const x = this.clampX(event, plot);
    this.band.set({ left: Math.min(this.selectFrom, x), width: Math.abs(x - this.selectFrom), top: plot.top, height: plot.height });
  }

  protected selectEnd(event: PointerEvent): void {
    const plot = this.plot();
    const chart = this.chart();
    const from = this.selectFrom;
    this.selectFrom = null;
    this.band.set(null);
    if (from === null || !plot || !chart || event.type === 'pointercancel') {
      return;
    }
    const to = this.clampX(event, plot);
    if (Math.abs(to - from) < MIN_SELECT_PX) {
      return;
    }
    const at = (x: number) => Number(chart.convertFromPixel({ xAxisIndex: 0 }, x));
    const [start, end] = [at(Math.min(from, to)), at(Math.max(from, to))];
    if (Number.isFinite(start) && Number.isFinite(end)) {
      this.selected.emit({ start, end });
    }
  }

  private clampX(event: PointerEvent, plot: { left: number; width: number }): number {
    const box = this.host().nativeElement.getBoundingClientRect();
    return Math.min(Math.max(event.clientX - box.left, plot.left), plot.left + plot.width);
  }

  /** Moves the zoom window of the first slider to `[start, end]` without reporting it back as a change. */
  setZoom(start: number, end: number): void {
    this.chart()?.dispatchAction({ type: 'dataZoom', startValue: start, endValue: end }, { silent: true });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    this.chart()?.dispose();
  }
}
