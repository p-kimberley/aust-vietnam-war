import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, afterNextRender, computed, effect, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ScrollMemory } from '../../core/scroll-memory';
import { Seo } from '../../core/seo.service';
import { NotFound } from '../../pages/not-found';
import { UNITS, toursText } from './unit-facts';
import { UnitHistory } from './unit-history';
import { UnitList } from './unit-list';

/**
 * `/features/unit-histories`, `/features/unit-histories/<unit>` and `/features/unit-histories/<unit>/<sub-unit>`: the list of
 * units at the left, and at the right the introduction, or a unit's history (opened at a sub-unit's section when the address
 * names one). Rendered on the server from the committed histories (history.md).
 */
@Component({
  selector: 'app-unit-histories',
  imports: [RouterLink, UnitList, UnitHistory, NotFound],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (missing()) {
      <app-not-found />
    } @else {
      <div class="wrap page">
        <p class="data crumbs">
          <a routerLink="/features">Features</a> <span aria-hidden="true">›</span>
          @if (history()) {
            <a routerLink="/features/unit-histories">Unit Histories</a>
          } @else {
            <span>Unit Histories</span>
          }
        </p>
        <div class="layout">
          <app-unit-list class="side" [unit]="unit()" [sub]="sub()" />
          <div class="main">
            @if (history(); as h) {
              <app-unit-history [markdown]="h" [sub]="sub()" />
            } @else {
              <h1>Unit Histories</h1>
              <p class="lead">
                The war of each of the major Australian units, told from the contact records: what each did, where, and at what
                cost, with the roll of honour and photographs from the operations.
              </p>
              <ul class="cards">
                @for (u of units; track u.slug) {
                  <li>
                    <a [routerLink]="['/features/unit-histories', u.slug]">
                      <span class="name">{{ u.short }}</span>
                      <span class="title">{{ u.title }}</span>
                      <span class="data meta">{{ tours(u.tours) }}</span>
                      <span class="data meta">{{ u.contacts }} contacts · {{ u.dead }} dead</span>
                    </a>
                  </li>
                }
              </ul>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .page {
      padding-block: 1.5rem 3rem;
    }
    .crumbs {
      display: flex;
      gap: 0.4rem;
      margin: 0 0 1rem;
      font-size: 0.9rem;
      color: var(--text-muted);
    }
    .layout {
      display: grid;
      grid-template-columns: 15rem minmax(0, 1fr);
      gap: 2.5rem;
      align-items: start;
    }
    .side {
      position: sticky;
      top: 1rem;
      max-height: calc(100vh - 2rem);
      overflow-y: auto;
    }
    .lead {
      max-width: 44rem;
      font-size: 1.2rem;
      color: var(--text-muted);
    }
    .cards {
      list-style: none;
      margin: 1.5rem 0 0;
      padding: 0;
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    }
    .cards a {
      display: grid;
      gap: 0.2rem;
      height: 100%;
      padding: 0.9rem 1rem;
      color: var(--text);
      text-decoration: none;
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-top: 4px solid var(--olive-500);
      border-radius: var(--radius);
    }
    .cards a:hover {
      border-top-color: var(--brass);
    }
    .name {
      font-family: var(--font-display);
      font-size: 1.3rem;
      text-transform: uppercase;
    }
    .meta {
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    @media (max-width: 48rem) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
        gap: 1.25rem;
      }
      .side {
        position: static;
        max-height: none;
      }
    }
  `,
})
export class UnitHistories {
  /** From the address. */
  readonly unit = input<string | null>(null);
  readonly sub = input<string | null>(null);
  /** From the route's resolver: the unit's history.md, or null when the address names no unit. */
  readonly history = input<string | null>(null);

  protected readonly units = UNITS;
  protected readonly tours = toursText;

  /** The unit the address names, from the list. */
  private readonly entry = computed(() => UNITS.find((u) => u.slug === this.unit()));

  /** The address names a unit, or a section, that there is no history of. */
  protected readonly missing = computed(() => {
    const entry = this.entry();
    const sub = this.sub();
    return (!!this.unit() && (!this.history() || !entry)) || (!!entry && !!sub && !entry.subUnits.some((s) => s.slug === sub));
  });

  private readonly seo = inject(Seo);
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly scrollMemory = inject(ScrollMemory);

  constructor() {
    effect(() => {
      const u = this.history() ? this.entry() : undefined;
      const sub = u && this.sub() ? u.subUnits.find((x) => x.slug === this.sub()) : undefined;
      if (this.missing()) {
        this.seo.set({ title: 'Not found', path: '/features/unit-histories' });
        return;
      }
      if (!u) {
        this.seo.set({
          title: 'Unit Histories',
          description: 'The war of each of the major Australian units in Vietnam: what it did, where, and at what cost.',
          path: '/features/unit-histories',
        });
        return;
      }
      const path = `/features/unit-histories/${u.slug}${sub ? `/${sub.slug}` : ''}`;
      this.seo.set({
        title: sub ? `${sub.title}, ${u.short} · Unit Histories` : `${u.short} · Unit Histories`,
        description:
          `${u.title} in Vietnam, ${toursText(u.tours)}: ${u.contacts} recorded contacts in ` +
          `${u.operations} operations, with the roll of honour and photographs.`,
        path,
      });
    });

    // In the browser: at the section the address names, or at the top of a newly chosen unit; but going Back (or Forward) to a page
    // the reader has been on, where they left it, which the app's ScrollMemory sees to.
    effect(() => {
      const unit = this.unit();
      const sub = this.sub();
      afterNextRender(
        () => {
          const back = this.router.lastSuccessfulNavigation()?.trigger === 'popstate';
          if (back && this.scrollMemory.positionOf(this.router.url) !== undefined) return;
          // A section the address names (a sub-unit, or one of the page's own: "#roll-of-honour").
          const hash = decodeURIComponent(this.doc.location?.hash.slice(1) ?? '');
          const target = (sub ? this.doc.getElementById(sub) : null) ?? (hash ? this.doc.getElementById(hash) : null);
          if (target) target.scrollIntoView({ block: 'start' });
          else if (unit) this.doc.defaultView?.scrollTo({ top: 0 });
        },
        { injector: this.injector },
      );
    });
  }
}
