import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, resource, viewChild } from '@angular/core';
import { PoiService, poiLabel, typeName } from './poi';
import { Icon } from './icon';

/** "About this point": the name, type, year established and history of a fire support base or landing zone. */
@Component({
  selector: 'app-poi-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './poi-panel.html',
  styleUrl: './poi-panel.css',
})
export class PoiPanel {
  readonly poiId = input.required<number>();
  readonly closed = output<void>();

  private readonly pois = inject(PoiService);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly poi = resource({
    params: () => this.poiId(),
    loader: ({ params }) => this.pois.detail(params),
  });
  protected readonly poiLabel = poiLabel;
  protected readonly typeName = typeName;

  constructor() {
    // Move focus into the panel when a point opens, so keyboard and screen-reader users land on it.
    effect(() => {
      this.poiId();
      this.heading()?.nativeElement.focus({ preventScroll: true });
    });
  }
}
