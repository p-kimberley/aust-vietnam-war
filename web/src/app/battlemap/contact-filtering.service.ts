import { Injectable, computed, inject, signal } from '@angular/core';
import type { DateRange } from './analytics/timeline';
import { Contact } from './contacts';
import { FilterCatalogue, FilterCatalogueService } from './filter-catalogue';
import { FilterState, MIN_TEXT_LENGTH, NO_FILTERS, activeKeys, applyFilters } from './filters';
import { TextStatus } from './filters-panel';
import { UnitTree } from './unit-tree';

/** How long typing must pause before the report search is sent. */
const SEARCH_DELAY_MS = 400;

/**
 * The contacts, the filter catalogue and the filters chosen, and what they leave: filtering runs in the browser (the dataset
 * is small), and only the incident-report word search reaches the server, debounced and reading only the newest answer.
 *
 * Drawing what this leaves on the map, and fitting the camera to it, stays with the map in `Battlemap`: that also needs the
 * followed units' tracks and the room the panels take, neither of which is this service's business. `onSearched` is how it
 * tells `Battlemap` a search has answered, so the map can be brought up to date.
 *
 * Provided per map component, like `BasemapService`.
 */
@Injectable()
export class ContactFilteringService {
  private readonly filterService = inject(FilterCatalogueService);
  private searchTimer?: ReturnType<typeof setTimeout>;
  /** Identifies the latest search, so a slow answer to an older one is dropped. */
  private searchSeq = 0;

  /** Runs once a report search has answered (or failed) and was not superseded by a newer one. */
  onSearched: (() => void) | null = null;

  readonly allContacts = signal<readonly Contact[]>([]);
  readonly catalogue = signal<FilterCatalogue | null>(null);
  readonly tree = computed(() => {
    const c = this.catalogue();
    return c ? new UnitTree(c.units) : null;
  });
  readonly filters = signal<FilterState>(NO_FILTERS);
  /** Contacts whose report matches the search text; `null` before the first answer, or when there is no text. */
  readonly textIds = signal<ReadonlySet<number> | null>(null);
  readonly textStatus = signal<TextStatus>('idle');
  /** The contacts that pass the filters: what is drawn on the map. */
  readonly visible = computed(() => {
    const c = this.catalogue();
    return c ? applyFilters(this.allContacts(), this.filters(), c, this.textIds()) : this.allContacts();
  });
  /**
   * The contacts the operation list is drawn from: what the filters leave, except that the operation choice itself is ignored
   * (or, once one operation was chosen, no other could be added) and so are the dates (the list has its own time axis). So
   * choosing a unit, a task or a data source lists just the operations that have contacts of that unit, task or source.
   */
  readonly operationScope = computed(() => {
    const c = this.catalogue();
    return c ? applyFilters(this.allContacts(), { ...this.filters(), operations: new Set(), from: null, to: null }, c, this.textIds()) : this.allContacts();
  });
  /**
   * The contacts that pass every filter but the choice of operations: what the legend lists operations from, so that choosing
   * one there does not take the others out of the list.
   */
  readonly operationChoiceScope = computed(() => {
    const c = this.catalogue();
    return c ? applyFilters(this.allContacts(), { ...this.filters(), operations: new Set() }, c, this.textIds()) : this.allContacts();
  });
  /**
   * How many contacts each unit would leave if it, or its subtree, were chosen: every other active filter still applies
   * (dates and hours included), but not the unit filter itself, so choosing one unit does not make the others' counts
   * collapse to what only that unit already leaves.
   */
  readonly unitCounts = computed(() => {
    const c = this.catalogue();
    const t = this.tree();
    if (!c || !t) {
      return new Map<number, number>();
    }
    const scoped = applyFilters(this.allContacts(), { ...this.filters(), units: new Set() }, c, this.textIds());
    return t.countContacts(scoped);
  });
  /** The same idea as {@link unitCounts}, for the operation, unit task and data source checklists. */
  readonly operationCounts = computed(() => this.countsBy('op', 'operations'));
  readonly taskCounts = computed(() => this.countsBy('task', 'tasks'));
  readonly seriesCounts = computed(() => this.countsBy('series', 'series'));
  readonly activeCount = computed(() => activeKeys(this.filters()).length);
  /** The ids the charts are drawn from: what the map shows. */
  readonly visibleIds = computed(() => this.visible().map((c) => c.id));

  /** Counts, by name, of contacts that pass every filter but `key`, from the 1-based index a contact's `field` records. */
  private countsBy(field: 'op' | 'task' | 'series', key: 'operations' | 'tasks' | 'series'): ReadonlyMap<string, number> {
    const c = this.catalogue();
    if (!c) {
      return new Map();
    }
    const names = c[key];
    const scoped = applyFilters(this.allContacts(), { ...this.filters(), [key]: new Set<string>() }, c, this.textIds());
    const counts = new Map<string, number>();
    for (const contact of scoped) {
      const name = names[contact[field] - 1]?.name;
      if (name) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return counts;
  }

  /** Applies a change from the filter panel: sets the filters and, if the text changed, starts a report search. Answers whether the text changed. */
  setFilters(next: FilterState): boolean {
    const changedText = next.text !== this.filters().text;
    this.filters.set(next);
    if (changedText) {
      this.queueSearch(next.text);
    }
    return changedText;
  }

  /** Chooses an operation as a filter, or takes it off again; any number can be chosen. */
  toggleOperation(name: string): boolean {
    const operations = new Set(this.filters().operations);
    if (!operations.delete(name)) {
      operations.add(name);
    }
    return this.setFilters({ ...this.filters(), operations });
  }

  /** The timeline sets the same date filter as the filter panel does. */
  setDateRange(range: DateRange): boolean {
    return this.setFilters({ ...this.filters(), from: range.from, to: range.to });
  }

  /** Waits for typing to pause, then asks the server which reports contain the words. */
  queueSearch(text: string): void {
    clearTimeout(this.searchTimer);
    const seq = ++this.searchSeq;
    const words = text.trim();
    if (words.length < MIN_TEXT_LENGTH) {
      this.textIds.set(null);
      this.textStatus.set('idle');
      return;
    }
    this.textStatus.set('searching');
    this.searchTimer = setTimeout(() => void this.runSearch(words, seq), SEARCH_DELAY_MS);
  }

  /** Searches straight away, for text already in the filters when the map starts. */
  searchNow(text: string): Promise<void> {
    return this.runSearch(text.trim(), ++this.searchSeq);
  }

  private async runSearch(words: string, seq: number): Promise<void> {
    try {
      const ids = await this.filterService.search(words);
      if (seq !== this.searchSeq) return;
      this.textIds.set(new Set(ids));
      this.textStatus.set('ready');
    } catch (e) {
      if (seq !== this.searchSeq) return;
      console.warn('The report search failed', e);
      this.textIds.set(null);
      this.textStatus.set('error');
    }
    this.onSearched?.();
  }
}
