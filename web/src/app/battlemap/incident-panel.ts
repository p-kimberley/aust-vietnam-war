import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, resource, signal, viewChild } from '@angular/core';
import { NotesTab } from './community/notes-tab';
import { PeopleTab } from './community/people-tab';
import { PictureRef } from './community/community';
import { PicturesTab } from './community/pictures-tab';
import { ContactsService } from './contacts.service';
import { formatDtg } from './contacts';
import { FollowInfo } from './track';
import { Icon } from './icon';
import { PanelInfo } from './panel-info';
import { ReadMore } from './read-more';

/** What each section of an incident's details is, for its info button. */
export const INCIDENT_SECTION_INFO = {
  units: 'The Australian and allied units recorded as taking part. Follow a unit to draw its path from incident to incident on the map.',
  stats:
    'The numbers recorded for this incident: the size of each side\'s force present, and those killed and wounded. Enemy figures are as the Australians reported them.',
  summary:
    'The report below in plain English, written by an AI model to spell out its abbreviations and military shorthand. The original report is the authoritative record.',
  report:
    'The report as it was recorded at the time, mostly from the units\' commanders\' diaries and intelligence summaries, with its abbreviations and shorthand.',
  archive: "Where the original report is held: the Australian War Memorial's records (such as AWM95, the commanders' diaries) and other sources.",
} as const;

/**
 * "About this incident": the full record for one contact, loaded when it is selected on the map, with tabs for what the
 * community has added: notes, pictures, and the honour roll.
 */
@Component({
  selector: 'app-incident-panel',
  imports: [NotesTab, PicturesTab, PeopleTab, Icon, PanelInfo, ReadMore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './incident-panel.html',
  styleUrl: './incident-panel.css',
})
export class IncidentPanel {
  readonly contactId = input.required<number>();
  /** The tab to show when an incident opens (a note found by search opens on its notes). */
  readonly startTab = input<'details' | 'notes' | 'pictures' | 'people'>('details');
  readonly closed = output<void>();
  /** Opens a photo taken near this incident, on the map. */
  readonly openPicture = output<PictureRef>();
  /** Opens a person on the honour roll, by service number. */
  readonly openPerson = output<string>();
  /** The units whose paths are drawn on the map. */
  readonly following = input<ReadonlySet<number>>(new Set());
  /** For each followed unit that has a path: its colour and how many incidents it has. */
  readonly trackInfo = input<ReadonlyMap<number, FollowInfo>>(new Map());
  /** No more units can be followed. */
  readonly followFull = input(false);
  /** Follows a unit, or stops following it. */
  readonly follow = output<number>();

  private readonly contacts = inject(ContactsService);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly incident = resource({
    params: () => this.contactId(),
    loader: ({ params }) => this.contacts.detail(params),
  });
  protected readonly formatDtg = formatDtg;
  protected readonly tab = signal<'details' | 'notes' | 'pictures' | 'people'>('details');
  protected readonly notesCount = signal<number | null>(null);
  protected readonly picturesCount = signal<number | null>(null);
  protected readonly peopleCount = signal<number | null>(null);
  protected readonly info = INCIDENT_SECTION_INFO;

  constructor() {
    // Move focus into the panel when an incident opens, so keyboard and screen-reader users land on it.
    effect(() => {
      this.contactId();
      this.heading()?.nativeElement.focus({ preventScroll: true });
      // Another incident starts on its own details (or where search sent it), with counts to be found again.
      this.tab.set(this.startTab());
      this.notesCount.set(null);
      this.picturesCount.set(null);
      this.peopleCount.set(null);
    });
  }
}
