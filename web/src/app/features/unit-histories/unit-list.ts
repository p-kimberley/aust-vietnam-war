import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ARM_GROUPS, UNITS, UnitIndexEntry } from './unit-facts';

/**
 * The units with a history, grouped by arm, each with its sub-unit sections beneath it and its count of contacts; a box filters
 * them. On a phone it is a picker instead.
 */
@Component({
  selector: 'app-unit-list',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="picker">
      <span class="data">Unit</span>
      <select (change)="pick($any($event.target).value)">
        <option value="" [selected]="!unit()">All units</option>
        @for (u of units; track u.slug) {
          <option [value]="u.slug" [selected]="unit() === u.slug && !sub()">{{ u.short }}</option>
          @for (s of u.subUnits; track s.slug) {
            <option [value]="u.slug + '/' + s.slug" [selected]="unit() === u.slug && sub() === s.slug">&nbsp;&nbsp;{{ u.short }}, {{ s.title }}</option>
          }
        }
      </select>
    </label>

    <nav class="list" aria-label="Units">
      <label class="filter">
        <span class="visually-hidden">Filter the units</span>
        <input type="search" placeholder="Filter" [value]="query()" (input)="query.set($any($event.target).value)" />
      </label>
      @for (g of groups(); track g.name) {
        <h2 class="data group">{{ g.name }}</h2>
        <ul>
          @for (u of g.units; track u.slug) {
            <li>
              <a
                [routerLink]="['/features/unit-histories', u.slug]"
                [class.is-active]="unit() === u.slug && !sub()"
                [attr.aria-current]="unit() === u.slug && !sub() ? 'page' : null"
              >
                <span>{{ u.short }}</span><span class="count data">{{ u.contacts }}</span>
              </a>
              @if (u.subUnits.length && (unit() === u.slug || query())) {
                <ul class="subs">
                  @for (s of u.subUnits; track s.slug) {
                    <li>
                      <a
                        [routerLink]="['/features/unit-histories', u.slug, s.slug]"
                        [class.is-active]="unit() === u.slug && sub() === s.slug"
                        [attr.aria-current]="unit() === u.slug && sub() === s.slug ? 'page' : null"
                      >
                        <span>{{ s.title }}</span><span class="count data">{{ s.contacts }}</span>
                      </a>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>
      } @empty {
        <p class="none">No unit matches.</p>
      }
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }
    .picker {
      display: none;
      gap: 0.5rem;
      align-items: center;
    }
    .picker select {
      flex: 1;
      font: inherit;
      padding: 0.4rem;
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-radius: var(--radius);
    }
    .filter input {
      width: 100%;
      font: inherit;
      padding: 0.35rem 0.5rem;
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-radius: var(--radius);
    }
    .group {
      margin: 1.1rem 0 0.3rem;
      font-size: 0.8rem;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .subs {
      margin-left: 0.9rem;
      border-left: 1px solid var(--rule);
    }
    a {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.2rem 0.5rem;
      color: var(--text);
      text-decoration: none;
      border-radius: var(--radius);
    }
    .subs a {
      font-size: 0.95rem;
    }
    a:hover {
      background: var(--field);
      color: var(--text);
    }
    a.is-active {
      background: var(--olive-700);
      color: var(--paper);
    }
    .count {
      color: var(--text-muted);
      font-size: 0.85rem;
    }
    a.is-active .count {
      color: var(--khaki);
    }
    .none {
      color: var(--text-muted);
    }
    @media (max-width: 48rem) {
      .picker {
        display: flex;
      }
      .list {
        display: none;
      }
    }
  `,
})
export class UnitList {
  readonly unit = input<string | null>(null);
  readonly sub = input<string | null>(null);

  private readonly router = inject(Router);
  protected readonly units = UNITS;
  protected readonly query = signal('');

  /** The groups with the units that match the filter (by name, or by one of their sub-units' names). */
  protected readonly groups = computed(() => {
    const q = this.query().trim().toLowerCase();
    const match = (u: UnitIndexEntry) =>
      !q || [u.short, u.title, ...u.subUnits.map((s) => s.title)].some((n) => n.toLowerCase().includes(q));
    return ARM_GROUPS.map((g) => ({ name: g.name, units: UNITS.filter((u) => g.arms.includes(u.arm) && match(u)) })).filter(
      (g) => g.units.length,
    );
  });

  protected pick(value: string): void {
    void this.router.navigateByUrl(value ? `/features/unit-histories/${value}` : '/features/unit-histories');
  }
}
