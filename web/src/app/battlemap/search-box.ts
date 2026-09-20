import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { formatDtg } from './contacts';
import { Poi, poiLabel, typeName } from './poi';
import { ContactHit, MIN_SEARCH_LENGTH, SearchService, matchPois } from './search';

type Status = 'idle' | 'searching' | 'ready' | 'error';

/** One choice in the results list, in the order it is shown. */
type Option =
  | { kind: 'poi'; id: number; poi: Poi }
  | { kind: 'contact'; id: number; hit: ContactHit };

/** How long typing must pause before the report search is sent. */
const DELAY_MS = 300;

/**
 * Search for a base by name or an incident by the words in its report. Follows the ARIA combobox pattern: the field
 * keeps focus while Up and Down move through the results, Enter opens one and Escape closes the list.
 */
@Component({
  selector: 'app-search-box',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './search-box.html',
  styleUrl: './search-box.css',
})
export class SearchBox {
  readonly pois = input.required<readonly Poi[]>();
  readonly pickContact = output<number>();
  readonly pickPoi = output<number>();

  private readonly service = inject(SearchService);
  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  protected readonly query = signal('');
  protected readonly status = signal<Status>('idle');
  protected readonly open = signal(false);
  protected readonly active = signal(-1);
  protected readonly hits = signal<readonly ContactHit[]>([]);
  protected readonly total = signal(0);
  protected readonly minLength = MIN_SEARCH_LENGTH;

  protected readonly poiMatches = computed(() => matchPois(this.pois(), this.query()));
  /** Bases first, then incidents. */
  protected readonly options = computed<Option[]>(() => [
    ...this.poiMatches().map((poi): Option => ({ kind: 'poi', id: poi.id, poi })),
    ...this.hits().map((hit): Option => ({ kind: 'contact', id: hit.id, hit })),
  ]);
  protected readonly nothingFound = computed(
    () => this.query().trim().length >= MIN_SEARCH_LENGTH && this.status() === 'ready' && this.options().length === 0,
  );

  protected readonly formatDtg = formatDtg;
  protected readonly poiLabel = poiLabel;
  protected readonly typeName = typeName;

  protected optionId(i: number): string {
    return `search-option-${i}`;
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.open.set(true);
    this.active.set(-1);
    clearTimeout(this.timer);
    const seq = ++this.seq;
    const words = value.trim();
    if (words.length < MIN_SEARCH_LENGTH) {
      this.hits.set([]);
      this.total.set(0);
      this.status.set('idle');
      return;
    }
    this.status.set('searching');
    this.timer = setTimeout(() => void this.run(words, seq), DELAY_MS);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.open.set(true);
        this.active.set(count === 0 ? -1 : (this.active() + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.active.set(count === 0 ? -1 : (this.active() - 1 + count) % count);
        break;
      case 'Enter':
        if (this.open() && this.active() >= 0) {
          event.preventDefault();
          this.choose(this.options()[this.active()]);
        }
        break;
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          this.open.set(false);
          this.active.set(-1);
        }
        break;
    }
  }

  protected choose(option: Option | undefined): void {
    if (!option) {
      return;
    }
    this.open.set(false);
    this.active.set(-1);
    if (option.kind === 'poi') this.pickPoi.emit(option.id);
    else this.pickContact.emit(option.id);
  }

  /** Closes the list when focus leaves the search, unless it moved to a result being clicked. */
  protected onBlur(event: FocusEvent, root: HTMLElement): void {
    if (!root.contains(event.relatedTarget as Node | null)) {
      this.open.set(false);
    }
  }

  private async run(words: string, seq: number): Promise<void> {
    try {
      const found = await this.service.find(words);
      if (seq !== this.seq) return;
      this.hits.set(found.hits);
      this.total.set(found.total);
      this.status.set('ready');
    } catch (e) {
      if (seq !== this.seq) return;
      console.warn('The search failed', e);
      this.hits.set([]);
      this.status.set('error');
    }
  }
}
