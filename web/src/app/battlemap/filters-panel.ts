import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { AccordionSection } from './accordion-section';
import { ChecklistFilter } from './checklist-filter';
import { FilterCatalogue, NamedCount } from './filter-catalogue';
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
import { Icon } from './icon';

export type TextStatus = 'idle' | 'searching' | 'ready' | 'error';

/**
 * Every contact filter in one panel: dates and hours, the unit tree, operation, task, data source, strength and
 * casualty ranges, mine incidents and a word search of the incident reports. The panel owns no state; it shows the
 * {@link FilterState} it is given and emits a new one for every change.
 */
@Component({
  selector: 'app-filters-panel',
  imports: [AccordionSection, UnitTreeView, RangeFilter, ChecklistFilter, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './filters-panel.html',
  styleUrl: './filters-panel.css',
})
export class FiltersPanel {
  readonly state = input.required<FilterState>();
  readonly catalogue = input.required<FilterCatalogue>();
  readonly tree = input.required<UnitTree>();
  readonly unitCounts = input.required<ReadonlyMap<number, number>>();
  /**
   * How many contacts each operation, unit task or data source would leave if chosen, every other active filter (dates and
   * hours included) already applied. Names the catalogue lists but that count is not in are not currently reachable.
   */
  readonly operationCounts = input.required<ReadonlyMap<string, number>>();
  readonly taskCounts = input.required<ReadonlyMap<string, number>>();
  readonly seriesCounts = input.required<ReadonlyMap<string, number>>();
  /** Contacts passing the filters, and all contacts. */
  readonly shown = input.required<number>();
  readonly total = input.required<number>();
  readonly textStatus = input<TextStatus>('idle');
  readonly changed = output<FilterState>();

  /** The section that is open. Opening one closes the one before it, so at most one is open at a time. */
  protected readonly open = signal<string | null>(null);
  protected readonly hourBounds = { min: 0, max: 23 };
  protected readonly minText = MIN_TEXT_LENGTH;
  protected readonly seriesLabel = seriesLabel;
  protected readonly active = computed(() => activeKeys(this.state()));
  /** The catalogue's names, with each one's count replaced by how many contacts it would leave given the other active filters. */
  protected readonly operations = computed(() => withCounts(this.catalogue().operations, this.operationCounts()));
  protected readonly tasks = computed(() => withCounts(this.catalogue().tasks, this.taskCounts()));
  protected readonly series = computed(() => withCounts(this.catalogue().series, this.seriesCounts()));
  protected readonly ranges: readonly { key: RangeKey; label: string }[] = [
    { key: 'fr', label: 'Friendly strength' },
    { key: 'frCas', label: 'Friendly casualties' },
    { key: 'en', label: 'Enemy strength' },
    { key: 'enCas', label: 'Enemy casualties' },
  ];

  protected toggle(section: string): void {
    this.open.update((current) => (current === section ? null : section));
  }

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

/** Keeps the catalogue's names and order, but swaps in a scoped count; a name the scoped counts left out is at zero. */
function withCounts(items: readonly NamedCount[], counts: ReadonlyMap<string, number>): NamedCount[] {
  return items.map((i) => ({ name: i.name, count: counts.get(i.name) ?? 0 }));
}
