import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Seo } from '../core/seo.service';
import { UNITS } from './unit-histories/unit-facts';

/** `/features`: the site's longer pieces, drawn from its records, each with its own page. */
@Component({
  selector: 'app-features-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap page">
      <h1>Features</h1>
      <p class="lead">Longer pieces drawn from the site's records of the war: contacts, the roll of honour and photographs.</p>
      <ul class="features">
        <li>
          <h2><a routerLink="/features/unit-histories">Unit Histories</a></h2>
          <p>
            The war of each of the {{ units }} major Australian units, from the infantry battalions to the artillery, armour and engineers:
            what each did, where, and at what cost, with the roll of honour and photographs from the operations.
          </p>
          <a routerLink="/features/unit-histories">Read the unit histories</a>
        </li>
        <li class="soon">
          <h2>Operation Histories</h2>
          <p>The major operations, why they were mounted, the units in them, what happened and what they cost. Coming later.</p>
        </li>
      </ul>
    </div>
  `,
  styles: `
    .page {
      padding-block: 2.5rem 3rem;
    }
    .lead {
      max-width: 44rem;
      font-size: 1.2rem;
      color: var(--text-muted);
    }
    .features {
      list-style: none;
      margin: 2rem 0 0;
      padding: 0;
      display: grid;
      gap: 1.5rem;
      grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    }
    li {
      padding: 1.25rem 1.4rem;
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-top: 4px solid var(--brass);
      border-radius: var(--radius);
    }
    h2 a {
      color: inherit;
      text-decoration: none;
    }
    h2 a:hover {
      text-decoration: underline;
    }
    .soon {
      border-top-color: var(--rule);
      color: var(--text-muted);
    }
  `,
})
export class FeaturesPage {
  protected readonly units = UNITS.length;

  constructor() {
    inject(Seo).set({
      title: 'Features',
      description: "Longer pieces drawn from the site's records of Australia's Vietnam War, starting with the histories of the major units.",
      path: '/features',
    });
  }
}
