import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FollowRow } from './track';

/**
 * Which units are followed, and where the reader is along each one's path: a colour swatch per unit (its full name on
 * hover) and a pager showing the position, among that unit's own incidents, of whichever one is open (blank until one
 * is), with a button of its own to stop following it. Sits just above the legend, in the same kind of collapsible box;
 * the incident panel keeps its own colour swatch, so a followed unit's line can still be told apart there, but the
 * stepping and the stopping both live only here now.
 */
@Component({
  selector: 'app-follow-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="follow" aria-label="Followed units">
      <button type="button" class="follow__toggle" [attr.aria-expanded]="open()" aria-controls="follow-body" (click)="open.set(!open())">
        <span class="follow__title">Following {{ rows().length }} {{ rows().length === 1 ? 'unit' : 'units' }}</span>
        <span class="follow__chevron" aria-hidden="true"></span>
      </button>
      <div class="follow__frame" [class.is-open]="open()">
        <div class="follow__clip">
          <ul id="follow-body" class="follow__list">
            @for (row of rows(); track row.unit) {
              <li>
                <span class="follow__swatch" [style.background]="row.colour" aria-hidden="true"></span>
                <span class="follow__label" [attr.title]="row.fullName">{{ row.label }}</span>
                <span class="follow__pager data" role="group" [attr.aria-label]="'Step through the incidents of ' + row.label">
                  <button type="button" aria-label="Previous incident" title="Previous incident" (click)="step.emit({ unit: row.unit, direction: -1 })">‹</button>
                  <span>{{ row.at ?? '–' }}/{{ row.total }}</span>
                  <button type="button" aria-label="Next incident" title="Next incident" (click)="step.emit({ unit: row.unit, direction: 1 })">›</button>
                </span>
                <button
                  type="button"
                  class="follow__cancel"
                  [attr.aria-label]="'Stop following ' + row.label"
                  [attr.title]="'Stop following ' + row.label"
                  (click)="unfollow.emit(row.unit)"
                >
                  ×
                </button>
              </li>
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
    .follow {
      width: max-content;
      max-width: 100%;
      min-width: 11rem;
      color: var(--paper);
      font-size: 0.8rem;
      background: color-mix(in srgb, var(--olive-900) 96%, transparent);
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
    }
    .follow__toggle {
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
    .follow__toggle:hover {
      color: var(--brass);
    }
    .follow__title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* Points up when the panel is shut (it opens upward) and turns down when it is open. */
    .follow__chevron {
      flex: none;
      width: 0.45rem;
      height: 0.45rem;
      margin-top: 0.15rem;
      border: solid currentcolor;
      border-width: 2px 0 0 2px;
      transform: rotate(45deg);
      transition: transform 0.25s ease;
    }
    .follow__toggle[aria-expanded='true'] .follow__chevron {
      margin-top: -0.15rem;
      transform: rotate(225deg);
    }
    .follow__frame {
      display: grid;
      grid-template-rows: 0fr;
      visibility: hidden;
      transition:
        grid-template-rows 0.25s ease,
        visibility 0s linear 0.25s;
    }
    .follow__frame.is-open {
      grid-template-rows: 1fr;
      visibility: visible;
      transition:
        grid-template-rows 0.25s ease,
        visibility 0s;
    }
    .follow__clip {
      min-height: 0;
      overflow: hidden;
    }
    .follow__list {
      margin: 0;
      padding: 0.2rem 0.6rem 0.5rem;
      list-style: none;
      border-top: 1px solid var(--olive-700);
    }
    .follow__list li {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 1.6rem;
    }
    .follow__swatch {
      flex: none;
      width: 0.7rem;
      height: 0.7rem;
      border: 1px solid var(--olive-900);
      border-radius: 50%;
    }
    .follow__label {
      flex: 1 1 auto;
      min-width: 0;
      margin-right: 1rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .follow__pager {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 0.3rem;
    }
    .follow__pager button {
      width: 1.6rem;
      padding: 0.05rem 0;
      color: var(--paper);
      font-size: 1.1rem;
      line-height: 1;
      background: var(--olive-700);
      border: 1px solid var(--olive-500);
      cursor: pointer;
    }
    .follow__cancel {
      flex: none;
      width: 1.4rem;
      height: 1.4rem;
      margin-left: 0.15rem;
      color: var(--khaki);
      font-size: 0.9rem;
      line-height: 1;
      background: var(--olive-700);
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
      cursor: pointer;
    }
    .follow__cancel:hover {
      color: var(--smoke-yellow);
      border-color: var(--smoke-yellow);
    }
    @media (prefers-reduced-motion: reduce) {
      .follow__chevron,
      .follow__frame,
      .follow__frame.is-open {
        transition: none;
      }
    }
  `,
})
export class FollowPanel {
  readonly rows = input.required<readonly FollowRow[]>();
  /** Opens the previous or next incident of a followed unit. */
  readonly step = output<{ unit: number; direction: 1 | -1 }>();
  /** Stops following one unit. */
  readonly unfollow = output<number>();

  protected readonly open = signal(true);
}
