import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, afterNextRender, computed, effect, inject, input, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Seo } from '../../core/seo.service';
import { TimelineContent, layOut, phaseColour } from './timeline-data';
import { TimelineNavigator } from './timeline-navigator';
import { TimelinePhase } from './timeline-phase';
import { TimelineState, ZOOMS, Zoom } from './timeline-state';

/**
 * `/features/war-timeline`: what Australian forces did in Vietnam, and why, from 1965 to 1971, as a vertical timeline. Three
 * levels of zoom (the war's phases; their operations and months; their contacts), a way down from each row to the next, a unit to
 * narrow it to, and a rail of years to move along it. The zoom and the unit are kept in the address, so a view can be shared.
 */
@Component({
  selector: 'app-war-timeline',
  imports: [RouterLink, TimelineNavigator, TimelinePhase],
  providers: [TimelineState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap page">
      <p class="data crumbs"><a routerLink="/features">Features</a> <span aria-hidden="true">›</span> <span>War Timeline</span></p>
      <h1>The War, Phase by Phase</h1>
      <p class="lead">
        What Australian forces did in Vietnam from 1965 to 1971, and why: {{ facts().contacts.toLocaleString('en-AU') }} recorded contacts, from the war's
        phases down to single actions. Open any row for more, or change how far in you look.
      </p>
      <p class="note">
        The narratives are written by an AI model (Claude) from the contact records and from the sources each one cites, and reviewed
        here. Figures are the record's own; numbered marks lead to the sources for everything else. Friendly figures count everyone
        the record counts on the allied side: mostly Australians, with New Zealanders and at times Americans and South Vietnamese.
        Enemy figures are as the Australians recorded them.
      </p>

      <div class="controls" role="group" aria-label="Timeline view">
        <div class="zoom" role="radiogroup" aria-label="Zoom">
          @for (z of zooms; track z.id) {
            <button type="button" role="radio" [attr.aria-checked]="state.zoom() === z.id" [title]="z.hint" (click)="setZoom(z.id)">{{ z.label }}</button>
          }
        </div>
        <label class="unit">
          <span>Unit</span>
          <select [value]="state.unit()?.slug ?? ''" (change)="setUnit($any($event.target).value)">
            <option value="">All units</option>
            @for (u of facts().units; track u.slug) {
              <option [value]="u.slug">{{ u.short }}</option>
            }
          </select>
        </label>
      </div>

      <div class="layout">
        <nav class="years" aria-label="Years">
          <ol>
            @for (y of years(); track y.year) {
              <li><a [href]="'#' + y.anchor" (click)="jump($event, y.anchor)">{{ y.year }}</a></li>
            }
          </ol>
        </nav>
        <ol class="phases">
          @for (v of shown(); track v.phase.slug; let i = $index) {
            <li [style.--phase]="colour(v.index)"><app-timeline-phase [view]="v" [maxMonth]="maxMonth()" /></li>
          }
        </ol>
      </div>
      <app-timeline-navigator [views]="shown()" />
    </div>
  `,
  styles: `
    .page {
      padding-block: 1.5rem 4rem;
    }
    /* Room for the navigator at the right-hand edge, where the page's margin is too narrow to hold it. */
    @media (min-width: 40.01rem) and (max-width: 82rem) {
      .page {
        padding-right: 3.25rem;
      }
    }
    .crumbs {
      display: flex;
      gap: 0.4rem;
      margin: 0 0 1rem;
      font-size: 0.9rem;
      color: var(--text-muted);
    }
    .lead {
      max-width: 46rem;
      font-size: 1.2rem;
      color: var(--text-muted);
    }
    .note {
      max-width: 46rem;
      font-size: 0.9rem;
      color: var(--text-muted);
    }
    .controls {
      position: sticky;
      z-index: 2;
      top: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem 1.5rem;
      margin: 1.5rem 0 1rem;
      padding: 0.6rem 0;
      background: var(--surface);
      border-bottom: 1px solid var(--rule);
    }
    .zoom {
      display: inline-flex;
      border: 1px solid var(--rule);
      border-radius: var(--radius);
    }
    .zoom button {
      padding: 0.4rem 0.9rem;
      font: inherit;
      color: var(--text);
      background: var(--surface-raised);
      border: 0;
      cursor: pointer;
    }
    .zoom button + button {
      border-left: 1px solid var(--rule);
    }
    .zoom button[aria-checked='true'] {
      color: var(--paper);
      background: var(--olive-700);
    }
    .zoom button:focus-visible,
    select:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
    .unit {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }
    select {
      padding: 0.35rem 0.5rem;
      font: inherit;
      color: var(--text);
      background: var(--field);
      border: 1px solid var(--rule);
      border-radius: var(--radius);
    }
    .layout {
      display: grid;
      grid-template-columns: 4rem minmax(0, 1fr);
      gap: 1.5rem;
      align-items: start;
    }
    .years {
      position: sticky;
      top: 4rem;
    }
    .years ol {
      list-style: none;
      margin: 0;
      padding: 0;
      border-left: 2px solid var(--rule);
    }
    .years a {
      display: block;
      padding: 0.3rem 0 0.3rem 0.6rem;
      font-family: var(--font-data);
      color: var(--text-muted);
      text-decoration: none;
    }
    .years a:hover {
      color: var(--text);
      text-decoration: underline;
    }
    .phases {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    @media (max-width: 40rem) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }
      .years {
        display: none;
      }
    }
  `,
})
export class WarTimeline {
  /** The facts and narratives, from the route's resolver. */
  readonly content = input.required<TimelineContent>();

  protected readonly state = inject(TimelineState);
  protected readonly zooms = ZOOMS;
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  protected readonly facts = computed(() => this.content().facts);
  private readonly views = computed(() => layOut(this.content()));
  protected readonly shown = computed(() => {
    const shows = this.state.shows();
    return this.views().filter((v) => shows(v.phase.units));
  });
  protected readonly maxMonth = computed(() => Math.max(...this.facts().months.map((m) => m.contacts)));

  /** Each year's first phase, the place its link on the rail leads to. */
  protected readonly years = computed(() => {
    const years = new Map<string, string>();
    for (const v of this.views()) {
      for (let y = Number(v.phase.from.slice(0, 4)); y <= Number(v.phase.to.slice(0, 4)); y++) {
        if (!years.has(String(y))) years.set(String(y), v.phase.slug);
      }
    }
    return [...years].map(([year, anchor]) => ({ year, anchor }));
  });

  constructor() {
    inject(Seo).set({
      title: 'The War, Phase by Phase',
      description: 'What Australian forces did in Vietnam from 1965 to 1971, and why: a timeline from the war\'s phases down to single actions.',
      path: '/features/war-timeline',
    });

    // The units, and the view the address asks for (a shared link): its zoom and unit.
    effect(() => {
      const facts = this.facts();
      untracked(() => {
        this.state.units.set(new Map(facts.units.map((u) => [u.slug, u])));
        this.state.operations.set(facts.operations);
        const params = this.route.snapshot.queryParamMap;
        const zoom = params.get('zoom');
        if (ZOOMS.some((z) => z.id === zoom)) this.state.setZoom(zoom as Zoom);
        this.state.unit.set(facts.units.find((u) => u.slug === params.get('unit')) ?? null);
      });
    });

    // A link to a row (#op-coburg, #m-1968-02, a phase's slug) opens it and brings it into view.
    afterNextRender(() => this.openFragment(this.route.snapshot.fragment), { injector: this.injector });
  }

  protected readonly colour = phaseColour;

  protected setZoom(zoom: Zoom): void {
    this.state.setZoom(zoom);
    this.remember();
  }

  protected setUnit(slug: string): void {
    this.state.unit.set(this.facts().units.find((u) => u.slug === slug) ?? null);
    this.remember();
  }

  /** Moves to a year's first phase without changing the address. */
  protected jump(event: Event, anchor: string): void {
    event.preventDefault();
    this.document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private remember(): void {
    const zoom = this.state.zoom();
    void this.router.navigate([], {
      queryParams: { zoom: zoom === 'strategic' ? null : zoom, unit: this.state.unit()?.slug ?? null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private openFragment(fragment: string | null): void {
    if (!fragment) return;
    const views = this.views();
    const phase = views.find((v) => v.phase.slug === fragment);
    const entry = views.flatMap((v) => v.entries.map((e) => ({ v, e }))).find(({ e }) => (e.kind === 'month' ? 'm-' : 'op-') + e.key === fragment);
    if (phase) this.state.open(phase.phase.slug);
    else if (entry) this.state.open(entry.v.phase.slug, (entry.e.kind === 'month' ? 'month:' : 'op:') + entry.e.key);
    else return;
    afterNextRender(() => this.document.getElementById(fragment)?.scrollIntoView({ block: 'start' }), { injector: this.injector });
  }
}
