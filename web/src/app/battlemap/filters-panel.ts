import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ChecklistFilter } from './checklist-filter';
import { FilterCatalogue } from './filter-catalogue';
import {
  FilterKey,
  FilterState,
  MIN_TEXT_LENGTH,
  Mine,
  NO_FILTERS,
  Range,
  RangeKey,
  activeKeys,
  clearFilter,
  describeFilter,
  seriesLabel,
} from './filters';
import { RangeFilter } from './range-filter';
import { UnitTree } from './unit-tree';
import { UnitTreeView } from './unit-tree-view';

export type TextStatus = 'idle' | 'searching' | 'ready' | 'error';

/**
 * Every contact filter in one panel: dates and hours, the unit tree, operation, task, data source, strength and
 * casualty ranges, mine incidents and a word search of the incident reports. The panel owns no state; it shows the
 * {@link FilterState} it is given and emits a new one for every change.
 */
@Component({
  selector: 'app-filters-panel',
  imports: [UnitTreeView, RangeFilter, ChecklistFilter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './filters-panel.html',
  styleUrl: './filters-panel.css',
})
export class FiltersPanel {
  readonly state = input.required<FilterState>();
  readonly catalogue = input.required<FilterCatalogue>();
  readonly tree = input.required<UnitTree>();
  readonly unitCounts = input.required<ReadonlyMap<number, number>>();
  /** Contacts passing the filters, and all contacts. */
  readonly shown = input.required<number>();
  readonly total = input.required<number>();
  readonly textStatus = input<TextStatus>('idle');
  readonly changed = output<FilterState>();

  protected readonly hourBounds = { min: 0, max: 23 };
  protected readonly minText = MIN_TEXT_LENGTH;
  protected readonly seriesLabel = seriesLabel;
  protected readonly active = computed(() => activeKeys(this.state()));
  protected readonly ranges: readonly { key: RangeKey; label: string }[] = [
    { key: 'fr', label: 'Friendly strength' },
    { key: 'frCas', label: 'Friendly casualties' },
    { key: 'en', label: 'Enemy strength' },
    { key: 'enCas', label: 'Enemy casualties' },
  ];

  protected describe(key: FilterKey): string {
    return describeFilter(this.state(), key);
  }

  protected clear(key: FilterKey): void {
    this.changed.emit(clearFilter(this.state(), key));
  }

  protected clearAll(): void {
    this.changed.emit(NO_FILTERS);
  }

  protected setDate(side: 'from' | 'to', value: string): void {
    const { dateMin, dateMax } = this.catalogue();
    // A date at the edge of the data is no limit, so it is stored as none.
    const edge = side === 'from' ? dateMin : dateMax;
    this.changed.emit({ ...this.state(), [side]: value === '' || value === edge ? null : value });
  }

  protected setRange(key: RangeKey | 'hours', value: Range | null): void {
    this.changed.emit({ ...this.state(), [key]: value });
  }

  protected rangeValue(key: RangeKey): Range | null {
    return this.state()[key];
  }

  protected toggleUnit(id: number): void {
    this.changed.emit({ ...this.state(), units: this.tree().toggle(id, this.state().units) });
  }

  protected setNames(key: 'operations' | 'tasks' | 'series', names: ReadonlySet<string>): void {
    this.changed.emit({ ...this.state(), [key]: names });
  }

  protected setMine(value: Mine): void {
    this.changed.emit({ ...this.state(), mine: value });
  }

  protected setText(value: string): void {
    this.changed.emit({ ...this.state(), text: value });
  }
}
