import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { typeName } from './poi';
import { poiIconUrl } from './poi-icons';
import { storedFlag } from './stored-flag';

/** The order the types of point are listed in; any other type follows. */
const POI_ORDER = ['FSB', 'FSPB', 'LZ', 'Base'];

/**
 * A key to what is drawn on the map, at its bottom right. It lists only what is on the map at the moment: a layer that is
 * switched off, or a type of point that does not exist, has no entry. It opens and closes, and the choice is the reader's.
 *
 * The point icons are the map's own, drawn by the same code. The other symbols are small pictures in the same colours as the
 * layers (map paint cannot read CSS variables, so the colours are repeated from `contact-layers.ts`, `photo-layers.ts`
 * and `track.ts`).
 */
@Component({
  selector: 'app-map-legend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="legend" aria-label="Legend">
      <button type="button" class="legend__toggle" [attr.aria-expanded]="open()" aria-controls="legend-body" (click)="open.set(!open())">
        <span>Legend</span>
        <span class="legend__chevron" aria-hidden="true"></span>
      </button>
      <div class="legend__frame" [class.is-open]="open()">
        <div class="legend__clip">
          <ul id="legend-body" class="legend__list">
            @if (showContacts()) {
              <li>
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                  <circle cx="12" cy="12" r="6" fill="#c23a26" fill-opacity="0.9" stroke="#efe7cc" stroke-width="1.5" />
                </svg>
                <span>Contact</span>
              </li>
              @if (sizeField(); as size) {
                <li>
                  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                    <circle cx="4.5" cy="12" r="2.5" fill="#c23a26" stroke="#efe7cc" />
                    <circle cx="11.5" cy="12" r="4.5" fill="#c23a26" stroke="#efe7cc" />
                    <circle cx="19" cy="12" r="5" fill="#c23a26" stroke="#efe7cc" />
                  </svg>
                  <span>Larger for more: {{ size.toLowerCase() }}</span>
                </li>
              }
            }
            @if (showHeatmap()) {
              <li class="legend__heat">
                <span class="legend__label">Heatmap: {{ heatField().toLowerCase() }}</span>
                <span class="legend__ramp" aria-hidden="true"></span>
                <span class="legend__ends"><span>Fewer</span><span>More</span></span>
              </li>
            }
            @for (p of points(); track p.type) {
              <li>
                @if (p.url) {
                  <img [src]="p.url" width="24" height="24" alt="" />
                } @else {
                  <span class="legend__blank" aria-hidden="true"></span>
                }
                <span>{{ p.name }}</span>
              </li>
            }
            @if (showPhotos()) {
              <li>
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                  <circle cx="12" cy="12" r="6.5" fill="#efe7cc" stroke="#22251a" stroke-width="2.5" />
                </svg>
                <span>Community photo</span>
              </li>
            }
            @if (following()) {
              <li>
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                  <path d="M3 16 12 8 21 14" fill="none" stroke="#1f2314" stroke-opacity="0.6" stroke-width="6" stroke-linecap="round" />
                  <path d="M3 16 12 8 21 14" fill="none" stroke="#ffd166" stroke-width="3" stroke-dasharray="4 2.4" stroke-linecap="round" />
                  <circle cx="3" cy="16" r="3.5" fill="#ffd166" stroke="#1f2314" stroke-width="1.5" />
                  <circle cx="21" cy="14" r="3.5" fill="#ffd166" stroke="#1f2314" stroke-width="1.5" />
                </svg>
                <span>Path of a followed unit</span>
              </li>
            }
            @if (empty()) {
              <li class="legend__none">Nothing is switched on.</li>
            }
          </ul>
        </div>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .legend {
      width: max-content;
      max-width: 100%;
      min-width: 9rem;
      color: var(--paper);
      font-size: 0.8rem;
      background: color-mix(in srgb, var(--olive-900) 96%, transparent);
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
    }
    .legend__toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      width: 100%;
      padding: 0.3rem 0.6rem;
      color: var(--smoke-yellow);
      font-family: var(--font-display);
      font-size: 0.85rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: none;
      border: 0;
      cursor: pointer;
    }
    .legend__toggle:hover {
      color: var(--brass);
    }
    /* Points up when the legend is shut (it opens upward) and turns down when it is open. */
    .legend__chevron {
      width: 0.45rem;
      height: 0.45rem;
      margin-top: 0.15rem;
      border: solid currentcolor;
      border-width: 2px 0 0 2px;
      transform: rotate(45deg);
      transition: transform 0.25s ease;
    }
    .legend__toggle[aria-expanded='true'] .legend__chevron {
      margin-top: -0.15rem;
      transform: rotate(225deg);
    }
    .legend__frame {
      display: grid;
      grid-template-rows: 0fr;
      visibility: hidden;
      transition:
        grid-template-rows 0.25s ease,
        visibility 0s linear 0.25s;
    }
    .legend__frame.is-open {
      grid-template-rows: 1fr;
      visibility: visible;
      transition:
        grid-template-rows 0.25s ease,
        visibility 0s;
    }
    .legend__clip {
      min-height: 0;
      overflow: hidden;
    }
    .legend__list {
      margin: 0;
      padding: 0.2rem 0.6rem 0.5rem;
      list-style: none;
      border-top: 1px solid var(--olive-700);
    }
    .legend__list li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 1.5rem;
    }
    .legend__list img,
    .legend__list svg,
    .legend__blank {
      flex: none;
    }
    .legend__none {
      color: var(--khaki);
    }
    .legend__heat {
      flex-wrap: wrap;
      gap: 0.15rem 0.5rem;
      padding: 0.25rem 0;
    }
    .legend__label {
      flex: 0 0 100%;
    }
    .legend__ramp {
      flex: 0 0 100%;
      height: 0.6rem;
      background: linear-gradient(90deg, rgb(230 221 184 / 0.55), rgb(227 185 46 / 0.75), rgb(217 130 43 / 0.85), rgb(194 58 38 / 0.95));
      border: 1px solid var(--olive-500);
      border-radius: 2px;
    }
    .legend__ends {
      display: flex;
      flex: 0 0 100%;
      justify-content: space-between;
      color: var(--khaki);
      font-family: var(--font-data);
      font-size: 0.7rem;
    }
    @media (prefers-reduced-motion: reduce) {
      .legend__chevron,
      .legend__frame,
      .legend__frame.is-open {
        transition: none;
      }
    }
  `,
})
export class MapLegend {
  /** The contact markers are showing. */
  readonly showContacts = input(true);
  /** How markers are sized, by the name of the field, or `null` when they are all one size. */
  readonly sizeField = input<string | null>(null);
  readonly showHeatmap = input(true);
  /** The name of the field the heatmap shows. */
  readonly heatField = input('');
  /** The types of point that are on the map now (none when the layer is off). */
  readonly poiTypes = input<readonly string[]>([]);
  readonly showPhotos = input(false);
  /** A unit is being followed. */
  readonly following = input(false);

  /** Whether the legend is open; the browser remembers it from one visit to the next. */
  protected readonly open = storedFlag('battlemap.legendOpen', true);

  protected readonly points = computed(() =>
    [...new Set(this.poiTypes())]
      .sort((a, b) => rank(a) - rank(b))
      .map((type) => ({ type, name: typeName(type), url: poiIconUrl(type) })),
  );
  protected readonly empty = computed(() => !this.showContacts() && !this.showHeatmap() && this.points().length === 0 && !this.showPhotos() && !this.following());
}

function rank(type: string): number {
  const at = POI_ORDER.indexOf(type);
  return at < 0 ? POI_ORDER.length : at;
}
