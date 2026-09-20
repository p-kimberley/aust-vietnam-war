import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, resource, signal, viewChild } from '@angular/core';
import { NotesTab } from './community/notes-tab';
import { PeopleTab } from './community/people-tab';
import { PicturesTab } from './community/pictures-tab';
import { ContactsService } from './contacts.service';
import { formatDtg } from './contacts';

/**
 * "About this incident": the full record for one contact, loaded when it is selected on the map, with tabs for what the
 * community has added: notes, pictures, and the honour roll.
 */
@Component({
  selector: 'app-incident-panel',
  imports: [NotesTab, PicturesTab, PeopleTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './incident-panel.html',
  styleUrl: './incident-panel.css',
})
export class IncidentPanel {
  readonly contactId = input.required<number>();
  readonly closed = output<void>();
  /** Opens a person on the honour roll, by service number. */
  readonly openPerson = output<string>();

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

  constructor() {
    // Move focus into the panel when an incident opens, so keyboard and screen-reader users land on it.
    effect(() => {
      this.contactId();
      this.heading()?.nativeElement.focus();
      // Another incident starts on its own details, with counts to be found again.
      this.tab.set('details');
      this.notesCount.set(null);
      this.picturesCount.set(null);
      this.peopleCount.set(null);
    });
  }
}
