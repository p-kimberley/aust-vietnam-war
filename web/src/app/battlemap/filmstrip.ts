import { ChangeDetectionStrategy, Component, effect, input, model, output } from '@angular/core';
import type { MapView } from './basemap.service';
import type { IncidentMediaView } from './community/community';

/** A picture in the current view, and how far it is from the middle of the view. */
export interface ViewPicture {
  picture: IncidentMediaView;
  metres: number;
}

/** The most pictures the strip holds, so that a view of the whole country does not put hundreds of thumbnails on the page. */
export const MAX_IN_STRIP = 100;

const METRES_PER_DEGREE = 111_320;

/**
 * The pictures whose place is inside the map's view, nearest to the middle of the view first. Distances are worked out flat
 * (longitude narrowed by the latitude), which is exact enough over a screen. Nothing is asked of the server: the map already
 * holds every picture that has a place.
 */
export function picturesInView(pictures: readonly IncidentMediaView[], view: MapView | null): ViewPicture[] {
  if (!view) {
    return [];
  }
  const narrowing = Math.cos((view.lat * Math.PI) / 180);
  return pictures
    .filter((p) => p.lat !== null && p.lon !== null && p.lat >= view.south && p.lat <= view.north && p.lon >= view.west && p.lon <= view.east)
    .map((picture) => ({ picture, metres: Math.hypot((picture.lon! - view.lon) * narrowing, picture.lat! - view.lat) * METRES_PER_DEGREE }))
    .sort((a, b) => a.metres - b.metres || a.picture.id - b.picture.id)
    .slice(0, MAX_IN_STRIP);
}

/** A distance for a caption: metres below a kilometre, otherwise kilometres to one place. */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/**
 * The photos in the map's view, in a strip down the left edge, nearest the middle of the view first. An arrow on its edge makes
 * it wider, with a caption and how far away each photo is. Choosing a photo tells the map, which opens it.
 */
@Component({
  selector: 'app-filmstrip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <aside class="film" [class.is-wide]="expanded()" aria-label="Photos in view">
        <p class="film__count data" role="status">
          @if (expanded()) {
            {{ items().length }} {{ items().length === 1 ? 'photo' : 'photos' }} in view, nearest first
          } @else {
            <span aria-hidden="true">{{ items().length }}</span>
            <span class="visually-hidden">{{ items().length }} {{ items().length === 1 ? 'photo' : 'photos' }} in view</span>
          }
        </p>
        <ul id="film-list" class="film__list">
          @for (item of items(); track item.picture.id) {
            <li>
              <button
                type="button"
                class="thumb"
                [class.is-on]="item.picture.id === selectedId()"
                [attr.aria-pressed]="item.picture.id === selectedId()"
                [attr.aria-label]="(item.picture.caption || 'Photo') + ', ' + distance(item)"
                [attr.title]="(item.picture.caption || 'Photo') + ' (' + distance(item) + ' from the middle of the view)'"
                (click)="picked.emit(item.picture)"
              >
                <img class="thumb__img" [src]="item.picture.thumbUrl" alt="" loading="lazy" width="44" height="44" />
                @if (expanded()) {
                  <span class="thumb__text">
                    <span class="thumb__caption">{{ item.picture.caption || 'Photo' }}</span>
                    <span class="thumb__meta data">{{ distance(item) }}@if (item.picture.credit) { · {{ item.picture.credit }} }</span>
                  </span>
                }
              </button>
            </li>
          }
        </ul>
        <button
          type="button"
          class="film__toggle"
          [attr.aria-expanded]="expanded()"
          aria-controls="film-list"
          [attr.aria-label]="expanded() ? 'Make the photo strip narrower' : 'Make the photo strip wider'"
          (click)="expanded.set(!expanded())"
        >
          <span class="film__arrow" aria-hidden="true"></span>
        </button>
      </aside>
    }
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
    .film {
      position: relative;
      display: flex;
      flex-direction: column;
      width: 3.4rem;
      max-height: 100%;
      color: var(--paper);
      background: color-mix(in srgb, var(--olive-900) 92%, transparent);
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
      transition: width 0.25s ease;
    }
    .film.is-wide {
      width: 15rem;
    }
    .film__count {
      margin: 0;
      padding: 0.3rem 0.4rem;
      color: var(--khaki);
      font-size: 0.72rem;
      text-align: center;
      border-bottom: 1px solid var(--olive-700);
    }
    .film.is-wide .film__count {
      text-align: left;
    }
    .film__list {
      flex: 1 1 auto;
      min-height: 0;
      margin: 0;
      padding: 0.25rem;
      overflow-y: auto;
      list-style: none;
    }
    .film__list li + li {
      margin-top: 0.25rem;
    }

    .thumb {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      padding: 0;
      color: inherit;
      font: inherit;
      text-align: left;
      background: none;
      border: 2px solid transparent;
      border-radius: 3px;
      cursor: pointer;
    }
    .thumb:hover {
      border-color: var(--khaki);
    }
    .thumb.is-on {
      border-color: var(--smoke-yellow);
    }
    .thumb__img {
      flex: none;
      display: block;
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      background: var(--olive-700);
      border-radius: 1px;
    }
    .film.is-wide .thumb__img {
      width: 4.2rem;
      height: 4.2rem;
    }
    .thumb__text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      padding-right: 0.3rem;
      font-size: 0.78rem;
      line-height: 1.25;
    }
    .thumb__caption {
      display: -webkit-box;
      overflow: hidden;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .thumb__meta {
      overflow: hidden;
      color: var(--khaki);
      font-size: 0.7rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* The arrow tab on the strip's right edge, halfway down. */
    .film__toggle {
      position: absolute;
      top: 50%;
      right: -1.15rem;
      display: grid;
      place-content: center;
      width: 1.15rem;
      height: 3.4rem;
      padding: 0;
      color: var(--ink);
      background: var(--brass);
      border: 0;
      border-radius: 0 6px 6px 0;
      transform: translateY(-50%);
      cursor: pointer;
    }
    .film__toggle:hover {
      background: var(--smoke-yellow);
    }
    .film__arrow {
      width: 0.5rem;
      height: 0.5rem;
      border: solid currentcolor;
      border-width: 2px 2px 0 0;
      transform: translateX(-2px) rotate(45deg);
      transition: transform 0.25s ease;
    }
    .film__toggle[aria-expanded='true'] .film__arrow {
      transform: translateX(2px) rotate(225deg);
    }
    @media (prefers-reduced-motion: reduce) {
      .film,
      .film__arrow {
        transition: none;
      }
    }
  `,
})
export class Filmstrip {
  /** The photos in view, nearest the middle first. */
  readonly items = input.required<readonly ViewPicture[]>();
  /** The photo open in its panel, if any. */
  readonly selectedId = input<number | null>(null);
  /** Whether the strip is wide, with captions. */
  readonly expanded = model(false);
  /** A photo was chosen. */
  readonly picked = output<IncidentMediaView>();

  constructor() {
    // Keep the open photo in sight, whichever way it was opened.
    effect(() => {
      const id = this.selectedId();
      if (id !== null) {
        queueMicrotask(() => document.querySelector('.thumb.is-on')?.scrollIntoView?.({ block: 'nearest' }));
      }
    });
  }

  protected distance(item: ViewPicture): string {
    return formatDistance(item.metres);
  }
}
