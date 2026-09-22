import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { HonourSummary } from './community/community';
import { formatDtg } from './contacts';
import { Poi, poiLabel, typeName } from './poi';
import { CommunitySearchResult, ContactHit, FindResult, MIN_SEARCH_LENGTH, NoteHit, PictureHit, SearchService, matchPois } from './search';

type Status = 'idle' | 'searching' | 'ready' | 'error';

/** The kinds of thing the search can find. */
export type SearchKind = 'poi' | 'person' | 'contact' | 'note' | 'picture';

/** One choice in the results list, in the order it is shown. */
type Option =
  | { kind: 'poi'; id: number; poi: Poi }
  | { kind: 'person'; id: string; person: HonourSummary }
  | { kind: 'contact'; id: number; hit: ContactHit }
  | { kind: 'note'; id: number; note: NoteHit }
  | { kind: 'picture'; id: number; picture: PictureHit };

/** In the order they are listed in the menu and in the results. `short` names it on the menu button, `noun` in the placeholder. */
const KINDS: readonly { kind: SearchKind; label: string; short: string; noun: string; longNoun: string }[] = [
  { kind: 'poi', label: 'Bases and landing zones', short: 'Bases', noun: 'bases', longNoun: 'bases' },
  { kind: 'person', label: 'Honour roll', short: 'People', noun: 'people', longNoun: 'people on the honour roll' },
  { kind: 'contact', label: 'Incident reports', short: 'Reports', noun: 'reports', longNoun: 'incident reports' },
  { kind: 'note', label: 'Incident notes', short: 'Notes', noun: 'notes', longNoun: 'notes' },
  { kind: 'picture', label: 'Photos', short: 'Photos', noun: 'photos', longNoun: 'photos' },
];

/** How long typing must pause before the report search is sent. */
const DELAY_MS = 300;

const NO_REPORTS: FindResult = { hits: [], total: 0 };
const NO_PEOPLE = { items: [] as HonourSummary[], total: 0 };
const NO_COMMUNITY: CommunitySearchResult = { notes: [], noteTotal: 0, pictures: [], pictureTotal: 0 };

/** "a", "a and b", "a, b and c". */
function joinList(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Search for a base by name, a person on the honour roll, an incident by the words in its report, or a note or photo by its words. A
 * menu inside the box limits the search to any number of those kinds (none chosen means all of them), and a kind that is not
 * chosen is not asked for at all. Follows the ARIA combobox pattern: the field keeps focus while Up and Down move through the
 * results, Enter opens one and Escape closes the list.
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
  readonly pickPerson = output<string>();
  /** The incident a note is about, so it can be opened on its notes. */
  readonly pickNote = output<number>();
  readonly pickPicture = output<PictureHit>();

  private readonly service = inject(SearchService);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly typesButton = viewChild<ElementRef<HTMLButtonElement>>('typesButton');
  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  protected readonly query = signal('');
  protected readonly status = signal<Status>('idle');
  protected readonly open = signal(false);
  protected readonly active = signal(-1);
  protected readonly menuOpen = signal(false);
  /** The kinds the search is limited to. None means every kind. */
  protected readonly kinds = signal<ReadonlySet<SearchKind>>(new Set());
  protected readonly hits = signal<readonly ContactHit[]>([]);
  protected readonly people = signal<readonly HonourSummary[]>([]);
  protected readonly notes = signal<readonly NoteHit[]>([]);
  protected readonly pictures = signal<readonly PictureHit[]>([]);
  protected readonly total = signal(0);
  protected readonly minLength = MIN_SEARCH_LENGTH;
  protected readonly kindChoices = KINDS;

  /** The kinds being searched: those ticked, or every kind when none is. */
  private readonly chosen = computed(() => KINDS.filter((k) => this.kinds().size === 0 || this.kinds().has(k.kind)));
  /** Fewer than every kind is chosen. */
  protected readonly limited = computed(() => this.chosen().length < KINDS.length);
  protected readonly typesSummary = computed(() => {
    const chosen = this.chosen();
    return !this.limited() ? 'All types' : chosen.length === 1 ? chosen[0].short : `${chosen.length} types`;
  });
  protected readonly placeholder = computed(() => `Search ${joinList(this.chosen().map((k) => k.noun))}`);
  protected readonly label = computed(() => `Search ${joinList(this.chosen().map((k) => k.longNoun))}`);

  protected readonly poiMatches = computed(() => (this.wants('poi') ? matchPois(this.pois(), this.query()) : []));
  /** Bases first, then people on the honour roll, then incidents, then what members have written and added. */
  protected readonly options = computed<Option[]>(() => [
    ...this.poiMatches().map((poi): Option => ({ kind: 'poi', id: poi.id, poi })),
    ...(this.wants('person') ? this.people() : []).map((person): Option => ({ kind: 'person', id: person.serviceNumber, person })),
    ...(this.wants('contact') ? this.hits() : []).map((hit): Option => ({ kind: 'contact', id: hit.id, hit })),
    ...(this.wants('note') ? this.notes() : []).map((note): Option => ({ kind: 'note', id: note.id, note })),
    ...(this.wants('picture') ? this.pictures() : []).map((picture): Option => ({ kind: 'picture', id: picture.id, picture })),
  ]);
  protected readonly nothingFound = computed(
    () => this.query().trim().length >= MIN_SEARCH_LENGTH && this.status() === 'ready' && this.options().length === 0,
  );

  protected readonly formatDtg = formatDtg;
  protected readonly poiLabel = poiLabel;
  protected readonly typeName = typeName;

  private wants(kind: SearchKind): boolean {
    return this.kinds().size === 0 || this.kinds().has(kind);
  }

  protected optionId(i: number): string {
    return `search-option-${i}`;
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.open.set(true);
    this.menuOpen.set(false);
    this.active.set(-1);
    clearTimeout(this.timer);
    const seq = ++this.seq;
    const words = value.trim();
    if (words.length < MIN_SEARCH_LENGTH) {
      this.hits.set([]);
      this.people.set([]);
      this.notes.set([]);
      this.pictures.set([]);
      this.total.set(0);
      this.status.set('idle');
      return;
    }
    this.status.set('searching');
    this.timer = setTimeout(() => void this.run(words, seq), DELAY_MS);
  }

  /** Empties the field and puts the cursor back in it. */
  protected clear(): void {
    this.onInput('');
    this.field()?.nativeElement.focus();
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  /** Ticks or unticks a kind. The search is sent again at once, since the reader is not typing. */
  protected toggleKind(kind: SearchKind): void {
    const next = new Set(this.kinds());
    if (!next.delete(kind)) {
      next.add(kind);
    }
    this.kinds.set(next);
    this.refresh();
  }

  /** Back to searching every kind. */
  protected allKinds(): void {
    this.kinds.set(new Set());
    this.refresh();
    // The button that was pressed goes away with the choices, so focus moves to the one that opens the menu.
    this.typesButton()?.nativeElement.focus();
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.menuOpen.set(false);
      this.typesButton()?.nativeElement.focus();
    }
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
    else if (option.kind === 'person') this.pickPerson.emit(option.id);
    else if (option.kind === 'note') this.pickNote.emit(option.note.contactId);
    else if (option.kind === 'picture') this.pickPicture.emit(option.picture);
    else this.pickContact.emit(option.id);
  }

  /** Closes the list and the menu when focus leaves the search, unless it moved to a result being clicked. */
  protected onBlur(event: FocusEvent, root: HTMLElement): void {
    if (!root.contains(event.relatedTarget as Node | null)) {
      this.open.set(false);
      this.menuOpen.set(false);
    }
  }

  /** Asks again for the same words, at once. */
  private refresh(): void {
    const words = this.query().trim();
    this.active.set(-1);
    if (words.length < MIN_SEARCH_LENGTH) {
      return;
    }
    clearTimeout(this.timer);
    const seq = ++this.seq;
    this.status.set('searching');
    void this.run(words, seq);
  }

  private async run(words: string, seq: number): Promise<void> {
    // Only what is chosen is asked for. Incident reports and the honour roll live in Elasticsearch, so limiting the search to
    // bases, notes or photos leaves that alone.
    const reports = this.wants('contact');
    const roll = this.wants('person');
    const community = this.wants('note') || this.wants('picture');
    let extraFailed = false;
    try {
      // The honour roll, notes and photos are extras: if any cannot be searched, incidents and bases still can.
      const [found, people, written] = await Promise.all([
        reports ? this.service.find(words) : Promise.resolve(NO_REPORTS),
        roll
          ? this.service.people(words).catch(() => {
              extraFailed = true;
              return NO_PEOPLE;
            })
          : Promise.resolve(NO_PEOPLE),
        community
          ? this.service.community(words).catch(() => {
              extraFailed = true;
              return NO_COMMUNITY;
            })
          : Promise.resolve(NO_COMMUNITY),
      ]);
      if (seq !== this.seq) return;
      this.hits.set(found.hits);
      this.people.set(people.items);
      this.notes.set(written.notes);
      this.pictures.set(written.pictures);
      this.total.set(found.total);
      // With no incident search to fall back on, a failed extra is the whole story, so it is not hidden behind "Nothing matches".
      const nothing = found.hits.length + people.items.length + written.notes.length + written.pictures.length === 0;
      this.status.set(!reports && extraFailed && nothing && this.poiMatches().length === 0 ? 'error' : 'ready');
    } catch (e) {
      if (seq !== this.seq) return;
      console.warn('The search failed', e);
      this.hits.set([]);
      this.people.set([]);
      this.notes.set([]);
      this.pictures.set([]);
      this.status.set('error');
    }
  }
}
