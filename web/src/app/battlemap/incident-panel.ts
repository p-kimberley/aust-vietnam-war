import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, resource, viewChild } from '@angular/core';
import { ContactsService } from './contacts.service';
import { formatDtg } from './contacts';

/**
 * "About this incident": the full record for one contact, loaded when it is selected on the map. Honour roll, unit
 * follow and community notes join this panel in later phases.
 */
@Component({
  selector: 'app-incident-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './incident-panel.html',
  styleUrl: './incident-panel.css',
})
export class IncidentPanel {
  readonly contactId = input.required<number>();
  readonly closed = output<void>();

  private readonly contacts = inject(ContactsService);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly incident = resource({
    params: () => this.contactId(),
    loader: ({ params }) => this.contacts.detail(params),
  });
  protected readonly formatDtg = formatDtg;

  constructor() {
    // Move focus into the panel when an incident opens, so keyboard and screen-reader users land on it.
    effect(() => {
      this.contactId();
      this.heading()?.nativeElement.focus();
    });
  }
}
