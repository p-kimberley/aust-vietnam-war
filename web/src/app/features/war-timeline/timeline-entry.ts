import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ContactList } from './contact-list';
import { NarrativeText } from './narrative-text';
import { PhaseFacts, TimelineEntry as Entry, UnitCount, characterise, daySpan, monthName, withUnit } from './timeline-data';
import { TimelineState } from './timeline-state';

const DAY_MS = 86_400_000;
const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS;

/**
 * One row of a phase: a month of the Task Force's work, drawn as a bar of its contacts against the busiest month's, or an operation,
 * drawn as its span within the phase. Its summary shows always; opened, its narrative, its most significant contacts and the way
 * to it on the Battle Map.
 */
@Component({
  selector: 'app-timeline-entry',
  imports: [ContactList, NarrativeText],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-op]': "entry().kind === 'operation'", '[attr.id]': 'anchor()' },
  template: `
    <span class="dot" aria-hidden="true"></span>
    <p class="when data">{{ when() }}</p>
    <div class="body">
      <h4>
        <button type="button" class="head" [attr.aria-expanded]="open()" [attr.aria-controls]="anchor() + '-more'" (click)="state.toggleEntry(key())">
          <span class="title">{{ title() }}</span>
          <span class="chev" aria-hidden="true"></span>
        </button>
      </h4>
      <div class="graphic" aria-hidden="true">
        @if (bar(); as b) {
          <span class="track"><span class="bar" [style.left.%]="b.left" [style.width.%]="b.width"></span></span>
        }
        <span class="figures data">{{ figures() }}</span>
      </div>
      @if (entry().narrative?.summary; as summary) {
        <p class="summary">{{ summary }}</p>
      }
      @if (open()) {
        <div class="more" [id]="anchor() + '-more'" animate.enter="opening" animate.leave="closing">
          @if (entry().narrative; as n) {
            <app-narrative-text [narrative]="n" [id]="anchor()" />
          }
          @if (profile(); as p) {
            <p class="profile"><span class="label">In brief</span> {{ p }}</p>
          }
          @if (units().length) {
            <p class="units"><span class="label">Units</span> {{ units() }}</p>
          }
          <h5>Most significant contacts</h5>
          <app-contact-list [contacts]="notable()" />
          <a class="map" [href]="mapUrl()">Show {{ entry().kind === 'month' ? 'the month' : 'the operation' }} on the Battle Map</a>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      position: relative;
      display: grid;
      grid-template-columns: 7.5rem minmax(0, 1fr);
      gap: 0 1.5rem;
      padding: 0.55rem 0;
    }
    .dot {
      position: absolute;
      top: 1.05rem;
      left: calc(7.5rem + 0.75rem - 4px);
      width: 8px;
      height: 8px;
      background: var(--olive-500);
      border-radius: 50%;
    }
    :host(.is-op) .dot {
      background: var(--contact-red);
      border-radius: 1px;
      transform: rotate(45deg);
    }
    .when {
      margin: 0.35rem 0 0;
      font-size: 0.8rem;
      text-align: right;
      color: var(--text-muted);
    }
    .body {
      min-width: 0;
      padding-left: 0.25rem;
    }
    h4,
    h5 {
      margin: 0;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.2rem 0;
      font: inherit;
      font-size: 1.05rem;
      font-weight: 600;
      text-align: left;
      color: var(--text);
      background: none;
      border: 0;
      cursor: pointer;
    }
    :host(.is-op) .head {
      font-family: var(--font-display);
      font-weight: 400;
      letter-spacing: 0.02em;
    }
    .head:hover .title {
      text-decoration: underline;
    }
    .chev {
      width: 0.5rem;
      height: 0.5rem;
      border: solid var(--text-muted);
      border-width: 0 2px 2px 0;
      transform: rotate(45deg) translate(-2px, -2px);
      transition: transform 0.2s;
    }
    .head[aria-expanded='true'] .chev {
      transform: rotate(-135deg);
    }
    .graphic {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin: 0.1rem 0 0.25rem;
    }
    .track {
      position: relative;
      flex: 0 0 10rem;
      height: 0.45rem;
      background: color-mix(in srgb, var(--rule) 40%, transparent);
      border-radius: 1px;
    }
    .bar {
      position: absolute;
      top: 0;
      bottom: 0;
      min-width: 2px;
      background: var(--olive-500);
      border-radius: 1px;
    }
    :host(.is-op) .bar {
      background: var(--contact-red);
    }
    .figures {
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .summary {
      max-width: 46rem;
      margin: 0.1rem 0 0;
      color: var(--text);
    }
    .more {
      margin-top: 0.7rem;
    }
    .units,
    .profile {
      max-width: 46rem;
      font-size: 0.9rem;
    }
    .profile {
      margin: 0.9rem 0 0.4rem;
      padding: 0.5rem 0.75rem;
      background: color-mix(in srgb, var(--rule) 18%, transparent);
      border-left: 3px solid var(--contact-red);
    }
    /* Rises into view as it is scrolled to, where the browser can tie an animation to scrolling. */
    @supports (animation-timeline: view()) {
      @media (prefers-reduced-motion: no-preference) {
        :host {
          animation: reveal linear both;
          animation-timeline: view();
          animation-range: entry 0% entry 30%;
        }
      }
    }
    @keyframes reveal {
      from {
        opacity: 0;
        transform: translateY(14px);
      }
    }
    /* Opening, the content grows down into place (its height eased where the browser can), and closing, it folds away. */
    .opening,
    .closing {
      interpolate-size: allow-keywords;
    }
    .opening {
      overflow: clip;
      animation: open 0.3s ease-out;
    }
    .closing {
      overflow: clip;
      animation: close 0.2s ease-in forwards;
    }
    @keyframes open {
      from {
        height: 0;
        opacity: 0;
        transform: translateY(-6px);
      }
    }
    @keyframes close {
      to {
        height: 0;
        opacity: 0;
        transform: translateY(-6px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .opening,
      .closing {
        animation: none;
      }
    }
    .label,
    h5 {
      font-size: 0.75rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    h5 {
      margin: 0.8rem 0 0.5rem;
    }
    .map {
      display: inline-block;
      margin-top: 0.2rem;
      font-weight: 600;
    }
    @media (max-width: 40rem) {
      :host {
        grid-template-columns: minmax(0, 1fr);
        padding-left: 1.25rem;
      }
      .dot {
        left: 0;
      }
      .when {
        text-align: left;
      }
      .track {
        flex-basis: 6rem;
      }
    }
  `,
})
export class TimelineEntry {
  readonly entry = input.required<Entry>();
  readonly phase = input.required<PhaseFacts>();
  /** The busiest month's contacts, which a month's bar is drawn against. */
  readonly maxMonth = input.required<number>();

  protected readonly state = inject(TimelineState);

  protected readonly key = computed(() => (this.entry().kind === 'month' ? 'month:' : 'op:') + this.entry().key);
  protected readonly anchor = computed(() => (this.entry().kind === 'month' ? 'm-' : 'op-') + this.entry().key);
  protected readonly open = computed(() => this.state.entryOpen(this.key()));

  protected readonly title = computed(() => {
    const e = this.entry();
    return e.kind === 'month' ? monthName(e.month.month) : `Operation ${e.operation.name}`;
  });

  protected readonly when = computed(() => {
    const e = this.entry();
    return e.kind === 'month' ? monthName(e.month.month, true) : daySpan(e.operation.from, e.operation.to);
  });

  /** A month's contacts against the busiest month's; an operation's span within its phase. */
  protected readonly bar = computed(() => {
    const e = this.entry();
    if (e.kind === 'month') return { left: 0, width: (100 * e.month.contacts) / Math.max(1, this.maxMonth()) };
    const phase = this.phase();
    const span = Math.max(1, days(phase.from, phase.to));
    const left = Math.min(100, Math.max(0, (100 * days(phase.from, e.operation.from)) / span));
    return { left, width: Math.max(1.5, Math.min(100 - left, (100 * (days(e.operation.from, e.operation.to) + 1)) / span)) };
  });

  protected readonly figures = computed(() => {
    const e = this.entry();
    const f = e.kind === 'month' ? e.month : e.operation;
    const killed = f.casualties.frKia ? ` · ${f.casualties.frKia} friendly killed` : '';
    return `${f.contacts} contact${f.contacts === 1 ? '' : 's'}${killed}`;
  });

  /** What kind of operation it was, from its figures (see {@link characterise}); none for a month. */
  protected readonly profile = computed(() => {
    const e = this.entry();
    if (e.kind !== 'operation') return null;
    const units = this.state.units();
    return characterise(e.operation, this.state.operations(), (slug) => units.get(slug)?.short ?? slug);
  });

  protected readonly units = computed(() => {
    const e = this.entry();
    const list: UnitCount[] = e.kind === 'month' ? e.month.units : e.operation.units;
    return list.map((u) => `${this.state.units().get(u.slug)?.short ?? u.slug} (${u.contacts})`).join(', ');
  });

  protected readonly notable = computed(() => {
    const e = this.entry();
    return e.kind === 'month' ? e.month.notable : e.operation.notable;
  });

  protected readonly mapUrl = computed(() => {
    const e = this.entry();
    return withUnit(e.kind === 'month' ? e.month.mapUrl : e.operation.mapUrl, this.state.unit());
  });
}
