import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Casualties, TimelineContact, dayName } from './timeline-data';
import { TimelineState } from './timeline-state';

/**
 * A few words on a contact's casualties, as the record counts them: "17 friendly killed, 19 wounded; 245 enemy killed". Friendly is
 * everyone the record counts on the allied side: mostly Australians, with New Zealanders and at times Americans and South Vietnamese.
 */
export function casualtyWords(c: Casualties): string {
  const ours = [c.frKia && `${c.frKia} friendly killed`, c.frWia && `${c.frWia} wounded`].filter(Boolean);
  const theirs = [c.enKia && `${c.enKia} enemy killed`, c.enWia && `${c.enWia} wounded`].filter(Boolean);
  return [ours.join(', '), theirs.join(', ')].filter(Boolean).join('; ');
}

/**
 * The most significant contacts of a month or an operation, as the record tells them in plain English, each with the way to it on
 * the Battle Map. Narrowed to a unit, only that unit's.
 */
@Component({
  selector: 'app-contact-list',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown().length) {
      <ol class="contacts">
        @for (c of shown(); track c.id) {
          <li>
            <p class="meta data">
              <span>{{ day(c.date) }}</span>
              <span>{{ unitName(c) }}</span>
              @if (c.task) {
                <span>{{ c.task }}</span>
              }
              @if (casualties(c); as words) {
                <span class="cas">{{ words }}</span>
              }
            </p>
            <p class="summary">{{ c.summary || 'The record gives no summary of this contact.' }}</p>
            <a class="map" [routerLink]="'/battlemap'" [queryParams]="{ incident: c.id }">On the Battle Map</a>
          </li>
        }
      </ol>
    } @else {
      <p class="none">None of these contacts was {{ state.unit()?.short }}'s.</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .contacts {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      margin: 0 0 0.9rem;
      padding-left: 0.8rem;
      border-left: 2px solid var(--rule);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.2rem 0.9rem;
      margin: 0 0 0.2rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .cas {
      color: var(--enemy-rust);
    }
    .summary {
      max-width: 46rem;
      margin: 0 0 0.2rem;
      line-height: 1.5;
    }
    .map {
      font-size: 0.85rem;
    }
    .none {
      margin: 0;
      font-style: italic;
      color: var(--text-muted);
    }
  `,
})
export class ContactList {
  readonly contacts = input.required<readonly TimelineContact[]>();

  protected readonly state = inject(TimelineState);
  protected readonly shown = computed(() => {
    const unit = this.state.unit();
    return unit ? this.contacts().filter((c) => c.unit === unit.slug) : this.contacts();
  });
  protected readonly day = dayName;
  protected readonly casualties = (c: TimelineContact) => casualtyWords(c.casualties);

  /** The unit in contact: its history's short name and the sub-unit, or the record's label for it. */
  protected unitName(c: TimelineContact): string {
    const unit = c.unit ? this.state.units().get(c.unit) : undefined;
    return unit && unit.short !== c.unitLabel ? `${c.unitLabel}, ${unit.short}` : c.unitLabel;
  }
}
