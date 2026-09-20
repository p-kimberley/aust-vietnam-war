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

/** A chart. Draws `option`, follows the size of its box, reports zoom changes, and cleans up after itself. */
@Component({
  selector: 'app-echart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="host"></div>`,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    .host {
      width: 100%;
      height: 100%;
    }
  `,
})
export class EChart implements OnDestroy {
  readonly option = input.required<ChartOption>();
  /** Emitted when the reader changes the zoom of a time axis. */
  readonly zoomed = output<ZoomRange>();

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
