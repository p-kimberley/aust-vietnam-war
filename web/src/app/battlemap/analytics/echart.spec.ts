import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real library needs a canvas, which jsdom does not have, so it is replaced by a recording stand-in.
const chart = vi.hoisted(() => {
  const handlers: Record<string, () => void> = {};
  return {
    handlers,
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    dispatchAction: vi.fn(),
    getOption: vi.fn((): { dataZoom?: { startValue: number; endValue: number }[] } => ({ dataZoom: [{ startValue: 100, endValue: 200 }] })),
    on: vi.fn((name: string, handler: () => void) => {
      handlers[name] = handler;
    }),
  };
});
const init = vi.hoisted(() => vi.fn());
const use = vi.hoisted(() => vi.fn());

vi.mock('echarts/core', () => ({ init, use }));
vi.mock('echarts/charts', () => ({ LineChart: 'line', BarChart: 'bar' }));
vi.mock('echarts/components', () => ({
  GridComponent: 'grid',
  TooltipComponent: 'tooltip',
  LegendComponent: 'legend',
  DataZoomComponent: 'zoom',
  AriaComponent: 'aria',
}));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: 'canvas' }));

import { EChart } from './echart';

let resizeCallback: () => void = () => undefined;
const disconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  init.mockReturnValue(chart);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resizeCallback = cb;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});

async function mount(option: Record<string, unknown> = { a: 1 }) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(EChart);
  fixture.componentRef.setInput('option', option);
  const zooms: { start: number; end: number }[] = [];
  fixture.componentInstance.zoomed.subscribe((z) => zooms.push(z));
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r));
  fixture.detectChanges();
  return { fixture, zooms };
}

describe('EChart', () => {
  it('registers only the parts of the library it draws with, once, however many charts are made', async () => {
    await mount();
    await mount();

    expect(use).toHaveBeenCalledTimes(1);
    expect(use.mock.calls[0][0]).toEqual(['line', 'bar', 'grid', 'tooltip', 'legend', 'zoom', 'aria', 'canvas']);
  });

  it('draws the option on a canvas, replacing rather than merging, and again whenever it changes', async () => {
    const { fixture } = await mount({ a: 1 });
    expect(init).toHaveBeenCalledWith(expect.anything(), undefined, { renderer: 'canvas' });
    expect(chart.setOption).toHaveBeenLastCalledWith({ a: 1 }, { notMerge: true });

    fixture.componentRef.setInput('option', { b: 2 });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(chart.setOption).toHaveBeenLastCalledWith({ b: 2 }, { notMerge: true });
  });

  it('follows the size of its box', async () => {
    await mount();

    resizeCallback();

    expect(chart.resize).toHaveBeenCalled();
  });

  it('reports the zoom window when the reader moves it', async () => {
    const { zooms } = await mount();

    chart.handlers['datazoom']();

    expect(zooms).toEqual([{ start: 100, end: 200 }]);
  });

  it('says nothing when the chart has no zoom window to report', async () => {
    const { zooms } = await mount();
    chart.getOption.mockReturnValueOnce({});

    chart.handlers['datazoom']();

    expect(zooms).toEqual([]);
  });

  it('moves the zoom window without reporting it back', async () => {
    const { fixture } = await mount();

    fixture.componentInstance.setZoom(5, 9);

    expect(chart.dispatchAction).toHaveBeenCalledWith({ type: 'dataZoom', startValue: 5, endValue: 9 }, { silent: true });
  });

  it('cleans up when it goes away', async () => {
    const { fixture } = await mount();

    fixture.destroy();

    expect(chart.dispose).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });
});
