import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, output, signal } from '@angular/core';
import { CommunityService, HonourFacets, HonourFacetOption, HonourFilters, HonourSummary } from './community/community';
import { HonourPanel } from './community/honour-panel';

/** How many people one request brings back, and each "Show more" adds. */
export const ROLL_PAGE_SIZE = 20;
/** How long typing must pause before the roll is searched. */
export const ROLL_DELAY_MS = 300;

type Status = 'loading' | 'ready' | 'error';
type FilterKey = keyof HonourFilters;
type Chosen = Record<FilterKey, string>;

const NOTHING_CHOSEN: Chosen = { service: '', rank: '', corps: '' };

/** One of the drop-downs above the list. */
interface FilterList {
  key: FilterKey;
  label: string;
  all: string;
  options: readonly HonourFacetOption[];
  value: string;
}

/**
 * The nominal roll of those who died in service, in the panel that flies out from the left. It starts as the whole roll, by surname,
 * and narrows as a name or service number is typed or a service, rank or corps is chosen. Choosing a person shows their portrait and details, where they were born and
 * served, and the incidents and poppies linked to them; the arrow at the top goes back to the list, where it was.
 */
@Component({
  selector: 'app-nominal-roll',
  imports: [HonourPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (selected(); as serviceNumber) {
      <div class="detail">
        <button type="button" class="back" (click)="selected.set(null)"><span aria-hidden="true">←</span> Back to the roll</button>
        <div class="detail__panel">
          <app-honour-panel [serviceNumber]="serviceNumber" (closed)="selected.set(null)" (openIncident)="openIncident.emit($event)" />
        </div>
      </div>
    } @else {
      <section class="roll" aria-labelledby="roll-title">
        <header class="head">
          <h2 id="roll-title">Nominal roll</h2>
          <button type="button" class="close" aria-label="Close the nominal roll" (click)="closed.emit()">×</button>
        </header>

        <div class="find">
          <input
            type="search"
            class="find__input"
            autocomplete="off"
            maxlength="100"
            placeholder="Search by name or service number"
            aria-label="Search the nominal roll by name or service number"
            [value]="query()"
            (input)="onInput($any($event.target).value)"
          />
        </div>

        <div class="filters" role="group" aria-label="Restrict the roll">
          @for (list of lists(); track list.key) {
            <select class="filter" [attr.aria-label]="list.label" (change)="choose(list.key, $any($event.target).value)">
              <option value="" [selected]="list.value === ''">{{ list.all }}</option>
              @for (option of list.options; track option.value) {
                <option [value]="option.value" [selected]="option.value === list.value">{{ option.value }} ({{ option.count }})</option>
              }
            </select>
          }
        </div>

        <p class="count data" role="status" aria-live="polite">
          {{ summary() }}
          @if (restricted()) {
            <button type="button" class="clear" (click)="clearFilters()">Clear filters</button>
          }
        </p>

        @if (status() === 'error') {
          <p class="error" role="alert">The roll could not be searched. Try again in a moment.</p>
          <button type="button" class="more" (click)="reload()">Try again</button>
        }

        <ul class="list" aria-label="People on the roll">
          @for (person of people(); track person.serviceNumber) {
            <li>
              <button type="button" class="person" (click)="selected.set(person.serviceNumber)">
                @if (person.portraitUrl) {
                  <img class="person__portrait" [src]="person.portraitUrl" alt="" width="36" height="44" loading="lazy" />
                } @else {
                  <svg class="person__portrait person__portrait--none" viewBox="0 0 36 44" aria-hidden="true" focusable="false">
                    <circle cx="18" cy="16" r="7" fill="currentColor" />
                    <path d="M4 44c0-10 6-15 14-15s14 5 14 15z" fill="currentColor" />
                  </svg>
                }
                <span class="person__text">
                  <span class="person__name">{{ person.sortName || person.name }}</span>
                  <span class="person__meta data">{{ meta(person) }}</span>
                </span>
              </button>
            </li>
          }
        </ul>

        @if (people().length < total() && status() !== 'error') {
          <button type="button" class="more" [disabled]="status() === 'loading'" (click)="showMore()">Show more</button>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      max-height: 100%;
    }
    .roll,
    .detail {
      display: flex;
      flex-direction: column;
      min-height: 0;
      max-height: 100%;
      background: color-mix(in srgb, var(--olive-900) 97%, transparent);
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
      color: var(--paper);
    }
    .detail {
      height: 100%;
    }
    .detail__panel {
      flex: 1;
      min-height: 0;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--olive-500);
    }
    h2 {
      margin: 0;
      color: var(--smoke-yellow);
      font-family: var(--font-display);
      font-size: 1rem;
    }
    .close,
    .back,
    .more {
      color: var(--paper);
      font: inherit;
      background: none;
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
      cursor: pointer;
    }
    .close {
      width: 2rem;
      height: 2rem;
      padding: 0;
      font-size: 1.4rem;
      line-height: 1;
    }
    .back {
      align-self: flex-start;
      margin: 0.4rem 0.5rem 0.2rem;
      padding: 0.25rem 0.6rem;
      font-size: 0.85rem;
    }
    .find {
      padding: 0.6rem 0.75rem 0;
    }
    .find__input {
      box-sizing: border-box;
      width: 100%;
      padding: 0.4rem 0.6rem;
      color: var(--ink);
      font: inherit;
      font-size: 0.9rem;
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: var(--radius);
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      padding: 0.5rem 0.75rem 0;
    }
    .filter {
      flex: 1 1 7rem;
      min-width: 0;
      padding: 0.3rem 0.4rem;
      color: var(--ink);
      font: inherit;
      font-size: 0.8rem;
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: var(--radius);
    }
    .count {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin: 0.4rem 0.75rem;
      color: var(--khaki);
      font-size: 0.78rem;
    }
    .clear {
      padding: 0.1rem 0.5rem;
      color: var(--paper);
      font: inherit;
      font-size: 0.75rem;
      background: none;
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
      cursor: pointer;
    }
    .error {
      margin: 0 0.75rem 0.4rem;
      color: var(--contact-red-bright);
    }
    .list {
      flex: 1 1 auto;
      min-height: 0;
      margin: 0;
      padding: 0 0.5rem;
      overflow-y: auto;
      list-style: none;
    }
    .person {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      width: 100%;
      padding: 0.3rem 0.4rem;
      color: inherit;
      font: inherit;
      text-align: left;
      background: none;
      border: 0;
      border-bottom: 1px solid var(--olive-700);
      cursor: pointer;
    }
    .person:hover {
      background: var(--olive-700);
    }
    .person__portrait {
      flex: none;
      width: 2.25rem;
      height: 2.75rem;
      object-fit: cover;
      background: var(--olive-700);
      border: 1px solid var(--olive-500);
      border-radius: 2px;
    }
    /* The silhouette that stands in for a portrait that has not been found. */
    .person__portrait--none {
      color: var(--olive-500);
    }
    .person__text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .person__name {
      font-family: var(--font-display);
    }
    .person__meta {
      color: var(--khaki);
      font-size: 0.75rem;
    }
    .more {
      margin: 0.5rem 0.75rem 0.75rem;
      padding: 0.35rem 0.75rem;
    }
    .close:focus-visible,
    .back:focus-visible,
    .more:focus-visible,
    .person:focus-visible,
    .clear:focus-visible,
    .filter:focus-visible,
    .find__input:focus-visible {
      outline: 2px solid var(--smoke-yellow);
      outline-offset: 2px;
    }
  `,
})
export class NominalRoll implements OnDestroy {
  /** The panel was closed. */
  readonly closed = output<void>();
  /** An incident linked to the person on show was chosen. */
  readonly openIncident = output<number>();

  private readonly api = inject(CommunityService);
  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;
  private page = 0;

  protected readonly query = signal('');
  protected readonly people = signal<readonly HonourSummary[]>([]);
  protected readonly total = signal(0);
  protected readonly status = signal<Status>('loading');
  /** The service, rank and corps chosen; an empty one is no restriction. */
  protected readonly chosen = signal<Chosen>({ ...NOTHING_CHOSEN });
  /** What each drop-down offers, as the last search counted it. */
  protected readonly facets = signal<HonourFacets | null>(null);
  /** The service number of the person on show, or `null` for the list. */
  protected readonly selected = signal<string | null>(null);

  protected readonly restricted = computed(() => Object.values(this.chosen()).some(Boolean));

  protected readonly lists = computed<FilterList[]>(() => {
    const facets = this.facets();
    const chosen = this.chosen();
    return [
      { key: 'service', label: 'Service', all: 'All services', options: facets?.services ?? [], value: chosen.service },
      { key: 'rank', label: 'Rank', all: 'All ranks', options: facets?.ranks ?? [], value: chosen.rank },
      { key: 'corps', label: 'Corps', all: 'All corps', options: facets?.corps ?? [], value: chosen.corps },
    ];
  });

  protected readonly summary = computed(() => {
    if (this.status() === 'loading' && this.people().length === 0) {
      return 'Loading the roll…';
    }
    const total = this.total();
    const shown = this.people().length;
    if (total === 0) {
      return this.status() === 'error' ? '' : 'Nobody matches.';
    }
    return shown < total ? `Showing ${shown} of ${total} people` : `${total} ${total === 1 ? 'person' : 'people'}`;
  });

  constructor() {
    void this.load(true);
  }

  /** What is known of each person at a glance: rank, corps and the year of death. */
  protected meta(person: HonourSummary): string {
    return [person.rank, person.branch, person.death ? `died ${person.death.slice(0, 4)}` : null].filter(Boolean).join(' · ');
  }

  protected onInput(value: string): void {
    this.query.set(value);
    clearTimeout(this.timer);
    this.status.set('loading');
    this.timer = setTimeout(() => void this.load(true), ROLL_DELAY_MS);
  }

  /** Restricts the roll to one service, rank or corps (or, with an empty value, to all of them), and lists it again. */
  protected choose(key: FilterKey, value: string): void {
    clearTimeout(this.timer);
    this.chosen.update((c) => ({ ...c, [key]: value }));
    void this.load(true);
  }

  protected clearFilters(): void {
    clearTimeout(this.timer);
    this.chosen.set({ ...NOTHING_CHOSEN });
    void this.load(true);
  }

  protected showMore(): void {
    void this.load(false);
  }

  protected reload(): void {
    void this.load(true);
  }

  /** Asks for a page of the roll: the first, for a new search, or the one after what is shown. */
  private async load(fresh: boolean): Promise<void> {
    const seq = ++this.seq;
    const page = fresh ? 1 : this.page + 1;
    this.status.set('loading');
    try {
      // The drop-down choices change with what is chosen and typed, so a new search asks for them again; a further page does not.
      const result = await this.api.honourRoll(this.query().trim(), page, ROLL_PAGE_SIZE, this.chosen(), fresh);
      if (seq !== this.seq) {
        return;
      }
      this.page = page;
      this.people.set(fresh ? result.items : [...this.people(), ...result.items]);
      this.total.set(result.total);
      if (result.facets) {
        this.facets.set(result.facets);
      }
      this.status.set('ready');
    } catch (e) {
      if (seq !== this.seq) {
        return;
      }
      console.warn('The nominal roll could not be searched', e);
      this.status.set('error');
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
