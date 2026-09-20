import { Component, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Type } from '@angular/core';
import type { ChartOption } from './analytics';
import { EChart, ZoomRange } from './echart';

/** A stand-in for {@link EChart} in tests: jsdom has no canvas, so nothing can be drawn, but the option it was given can be read. */
@Component({ selector: 'app-echart', template: '' })
export class StubEChart {
  readonly option = input.required<ChartOption>();
  readonly zoomed = output<ZoomRange>();
}

/** Makes `host` use the stand-in wherever it would have used the real chart. */
export function stubEchartIn(host: Type<unknown>): void {
  TestBed.overrideComponent(host, { remove: { imports: [EChart] }, add: { imports: [StubEChart] } });
}
