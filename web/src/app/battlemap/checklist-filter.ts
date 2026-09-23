import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { NamedCount } from './filter-catalogue';

/** A list of named choices with counts, ticked to include. Long lists get a search box. */
@Component({
  selector: 'app-checklist-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './checklist-filter.html',
  styleUrl: './checklist-filter.css',
})
export class ChecklistFilter {
  readonly label = input.required<string>();
  readonly items = input.required<readonly NamedCount[]>();
  readonly selected = input.required<ReadonlySet<string>>();
  /** Shows a search box above this many items. */
  readonly searchAbove = input(8);
  /** Turns a recorded name into what is shown, for example the full name of a data source. */
  readonly display = input<(name: string) => string>((name) => name);
  readonly changed = output<ReadonlySet<string>>();

  protected readonly query = signal('');
  /** Items a choice could still leave with a contact, plus any already chosen (so clearing one that a filter has since emptied is still possible). */
  protected readonly reachable = computed(() => this.items().filter((i) => i.count > 0 || this.selected().has(i.name)));
  protected readonly searchable = computed(() => this.reachable().length > this.searchAbove());
  protected readonly shown = computed(() => {
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return this.reachable();
    return this.reachable().filter((i) => {
      const text = `${i.name} ${this.display()(i.name)}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  });

  protected toggle(name: string, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(name);
    else next.delete(name);
    this.changed.emit(next);
  }
}
