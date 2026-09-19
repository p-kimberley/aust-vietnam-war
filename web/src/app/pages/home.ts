import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <div class="wrap">
        <p class="data hero__kicker">1965 – 1971</p>
        <h1>Australia's<br />Vietnam War</h1>
        <p class="hero__lead">
          Explore more than six thousand recorded contacts on an interactive map, read the stories behind them,
          and remember the people who served.
        </p>
        <a class="btn" routerLink="/battlemap">Open the Battle Map</a>
      </div>
    </section>

    <section class="wrap tiles" aria-label="Explore">
      <article class="tile">
        <h2>Battle Map</h2>
        <p>Every recorded contact from 1965 to 1971, with units, incidents, media and community notes.</p>
        <a routerLink="/battlemap">Explore the map</a>
      </article>
      <article class="tile">
        <h2>Honour roll</h2>
        <p>The names of those who died, with portraits and biographies where they are known.</p>
        <a routerLink="/battlemap">See the honour roll</a>
      </article>
      <article class="tile">
        <h2>Latest news</h2>
        <p class="data">No articles have been published yet.</p>
      </article>
    </section>
  `,
  styles: `
    .hero {
      background:
        linear-gradient(180deg, rgb(31 35 20 / 0.92), rgb(53 61 34 / 0.92)),
        repeating-linear-gradient(45deg, var(--olive-700) 0 6px, var(--olive-900) 6px 12px);
      color: var(--paper);
      padding-block: clamp(3rem, 10vw, 6rem);
    }
    .hero h1 {
      color: var(--paper);
      margin-bottom: 0.4em;
    }
    .hero__kicker {
      color: var(--smoke-yellow);
      margin: 0 0 0.5rem;
      font-size: 1.1rem;
    }
    .hero__lead {
      max-width: 40rem;
      font-size: 1.2rem;
      color: var(--khaki);
      margin-bottom: 1.75rem;
    }
    .tiles {
      display: grid;
      gap: 1.5rem;
      grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
      margin-top: 3rem;
    }
    .tile {
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-top: 4px solid var(--brass);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
    }
    .tile h2 {
      font-size: 1.3rem;
    }
    .tile p {
      margin-top: 0;
    }
  `,
})
export class Home {}
