import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Client-only route (never server-rendered). The Mapbox GL map arrives in phase 2; this reserves the route,
 * the full-viewport layout and the dark surface the map will use.
 */
@Component({
  selector: 'app-battlemap',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="map">
      <a class="back" routerLink="/">← Australia's Vietnam War</a>
      <div class="map__notice">
        <h1>Battle Map</h1>
        <p class="data">The interactive map is being rebuilt.</p>
      </div>
    </div>
  `,
  styles: `
    .map {
      position: relative;
      height: 100dvh;
      background: var(--olive-900);
      color: var(--paper);
      display: grid;
      place-items: center;
      text-align: center;
    }
    .back {
      position: absolute;
      top: 1rem;
      left: 1rem;
      color: var(--khaki);
    }
    h1 {
      color: var(--smoke-yellow);
    }
  `,
})
export class Battlemap {}
