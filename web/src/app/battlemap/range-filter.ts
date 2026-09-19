import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RangeInfo } from './filter-catalogue';
import { Range } from './filters';

/**
 * A "from - to" pair of number fields. Typed values are more precise than a slider for data like casualties, where
 * nearly every value is small and a few are very large. The fields are clamped to the data, kept in order, and a
 * range that covers everything is reported as `null` (no filter).
 */
@Component({
  selector: 'app-range-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './range-filter.html',
  styleUrl: './range-filter.css',
})
export class RangeFilter {
  readonly label = input.required<string>();
  readonly bounds = input.required<RangeInfo>();
  /** The active range, or `null` when the filter is off. */
  readonly value = input<Range | null>(null);
  readonly changed = output<Range | null>();

  protected readonly low = computed(() => this.value()?.[0] ?? this.bounds().min);
  protected readonly high = computed(() => this.value()?.[1] ?? this.bounds().max);

  protected commit(field: 'low' | 'high', raw: string): void {
    const { min, max } = this.bounds();
    const typed = Number.parseInt(raw, 10);
    let lo = this.low();
    let hi = this.high();
    if (field === 'low') lo = Number.isNaN(typed) ? min : typed;
    else hi = Number.isNaN(typed) ? max : typed;

    lo = Math.min(Math.max(lo, min), max);
    hi = Math.min(Math.max(hi, min), max);
    if (lo > hi) [lo, hi] = [hi, lo];
    this.changed.emit(lo === min && hi === max ? null : [lo, hi]);
  }
}
