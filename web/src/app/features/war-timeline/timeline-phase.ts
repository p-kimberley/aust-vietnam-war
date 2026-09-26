import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NarrativeText } from './narrative-text';
import { TimelineEntry } from './timeline-entry';
import { PhaseView, daySpan, withUnit } from './timeline-data';
import { TimelineState } from './timeline-state';

/**
 * A phase of the war: its title and dates, its figures, a chart of its months' contacts (the friendly killed marked in red), and
 * its summary; opened, its narrative and its operations and months, each of which opens in turn.
 */
@Component({
  selector: 'app-timeline-phase',
  imports: [NarrativeText, TimelineEntry],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.id]': 'view().phase.slug' },
  template: `
    <header class="head">
      <span class="marker" aria-hidden="true"></span>
      <p class="dates data">{{ dates() }}</p>
      <div class="title-row">
        <h3>
          <button type="button" [attr.aria-expanded]="open()" [attr.aria-controls]="view().phase.slug + '-body'" (click)="state.togglePhase(view().phase.slug)">
            {{ view().phase.title }}<span class="chev" aria-hidden="true"></span>
          </button>
        </h3>
        <p class="figures data">
          {{ view().phase.contacts }} contacts · {{ view().phase.casualties.frKia }} friendly killed,
          {{ view().phase.casualties.frWia }} wounded · {{ view().phase.casualties.enKia }} enemy recorded killed
        </p>
        <svg class="chart" [attr.viewBox]="'0 0 ' + chart().width + ' 40'" [attr.width]="chart().width * 2" height="40" role="img" [attr.aria-label]="chartLabel()">
          @for (b of chart().bars; track b.x) {
            <rect class="c" [attr.x]="b.x" [attr.y]="40 - b.h" width="3" [attr.height]="b.h"><title>{{ b.title }}</title></rect>
            @if (b.k) {
              <rect class="k" [attr.x]="b.x" [attr.y]="40 - b.k" width="3" [attr.height]="b.k" />
            }
          }
        </svg>
        @if (view().narrative?.summary; as summary) {
          <p class="summary">{{ summary }}</p>
        }
      </div>
    </header>
    @if (open()) {
      <div class="body" [id]="view().phase.slug + '-body'" animate.enter="opening" animate.leave="closing">
        @if (view().narrative; as n) {
          <app-narrative-text class="narrative" [narrative]="n" [id]="view().phase.slug" />
        }
        <p class="map"><a [href]="mapUrl()">Show the phase on the Battle Map</a></p>
        <ol class="entries">
          @for (e of entries(); track e.kind + e.key) {
            <li><app-timeline-entry [entry]="e" [phase]="view().phase" [maxMonth]="maxMonth()" /></li>
          } @empty {
            <li class="none">{{ state.unit()?.short }} took no part in this phase.</li>
          }
        </ol>
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      margin: 0 0 1.25rem;
    }
    .head {
      position: relative;
      display: grid;
      grid-template-columns: 7.5rem minmax(0, 1fr);
      gap: 0 1.5rem;
      padding: 0.9rem 1rem 0.9rem 0;
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-left: 6px solid var(--phase, var(--brass));
      border-radius: var(--radius);
    }
    .marker {
      position: absolute;
      top: 1.2rem;
      left: calc(7.5rem + 0.75rem - 9px);
      width: 14px;
      height: 14px;
      background: var(--phase, var(--brass));
      border: 2px solid var(--surface-raised);
      border-radius: 50%;
    }
    .dates {
      margin: 0.45rem 0 0;
      font-size: 0.8rem;
      text-align: right;
      color: var(--text-muted);
    }
    .title-row {
      min-width: 0;
      padding-left: 0.4rem;
    }
    h3 {
      margin: 0;
      font-size: 1.35rem;
    }
    h3 button {
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0;
      font: inherit;
      text-align: left;
      color: var(--text);
      background: none;
      border: 0;
      cursor: pointer;
    }
    h3 button:hover {
      text-decoration: underline;
    }
    .chev {
      width: 0.6rem;
      height: 0.6rem;
      border: solid var(--text-muted);
      border-width: 0 2px 2px 0;
      transform: rotate(45deg) translate(-3px, -3px);
      transition: transform 0.2s;
    }
    button[aria-expanded='true'] .chev {
      transform: rotate(-135deg);
    }
    .figures {
      margin: 0.3rem 0 0.4rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .chart {
      display: block;
      max-width: 100%;
    }
    .c {
      fill: var(--olive-500);
    }
    .k {
      fill: var(--contact-red);
    }
    .summary {
      max-width: 46rem;
      margin: 0.5rem 0 0;
      font-size: 1.05rem;
    }
    .body {
      position: relative;
      padding: 1rem 0 0;
    }
    .body::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: calc(7.5rem + 0.75rem);
      width: 2px;
      margin-left: -1px;
      background: var(--rule);
    }
    .narrative,
    .map {
      position: relative;
      margin-left: calc(7.5rem + 1.75rem);
    }
    .map {
      margin-top: 0;
      font-weight: 600;
    }
    .entries {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .none {
      margin-left: calc(7.5rem + 1.75rem);
      font-style: italic;
      color: var(--text-muted);
    }
    /* Rises into view as it is scrolled to, where the browser can tie an animation to scrolling. */
    @supports (animation-timeline: view()) {
      @media (prefers-reduced-motion: no-preference) {
        .head {
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
    @media (max-width: 40rem) {
      .head {
        grid-template-columns: minmax(0, 1fr);
        padding-left: 1rem;
      }
      .marker {
        display: none;
      }
      .dates {
        text-align: left;
      }
      .body::before {
        left: 0.25rem;
      }
      .narrative,
      .map,
      .none {
        margin-left: 1.25rem;
      }
    }
  `,
})
export class TimelinePhase {
  readonly view = input.required<PhaseView>();
  /** The busiest month's contacts on the whole timeline, which each month's bar is drawn against. */
  readonly maxMonth = input.required<number>();

  protected readonly state = inject(TimelineState);
  protected readonly open = computed(() => this.state.phaseOpen(this.view().phase.slug));
  protected readonly dates = computed(() => daySpan(this.view().phase.from, this.view().phase.to));
  protected readonly entries = computed(() => {
    const shows = this.state.shows();
    return this.view().entries.filter((e) => shows(e.kind === 'month' ? e.month.units : e.operation.units));
  });
  protected readonly mapUrl = computed(() => withUnit(this.view().phase.mapUrl, this.state.unit()));

  /** A column a month: its contacts, and, over them, its friendly killed (both against the busiest month's contacts). */
  protected readonly chart = computed(() => {
    const months = this.view().entries.flatMap((e) => (e.kind === 'month' ? [e.month] : []));
    const scale = 38 / Math.max(1, this.maxMonth());
    return {
      width: Math.max(1, months.length * 4),
      bars: months.map((m, i) => ({
        x: i * 4,
        h: Math.max(1, m.contacts * scale),
        k: m.casualties.frKia ? Math.max(1, Math.min(m.contacts, m.casualties.frKia) * scale) : 0,
        title: `${m.month}: ${m.contacts} contacts, ${m.casualties.frKia} friendly killed`,
      })),
    };
  });
  protected readonly chartLabel = computed(() => `Contacts month by month in this phase, from ${this.dates()}`);
}
