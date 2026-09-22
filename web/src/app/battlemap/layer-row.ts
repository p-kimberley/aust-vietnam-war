import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

let nextId = 0;

/**
 * One row of the Layers panel: whatever turns the layer on (a checkbox, or the basemap picker), and, when it has options
 * worth a slide-out for (a size, an opacity, which field to show), an arrow at the far right that opens them. The row owns
 * the open/shut state itself, and each row is independent, unlike the filter accordion where opening one shuts the rest.
 *
 * Project the switch into `[primary]` and the options into `[options]`; the body only exists when `expandable` is true, so a
 * layer with nothing to configure (points of interest, photos) is left as a plain checkbox with no row at all.
 */
@Component({
  selector: 'app-layer-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row">
      <div class="row__primary"><ng-content select="[primary]" /></div>
      @if (expandable()) {
        <button
          type="button"
          class="toggle"
          [id]="toggleId"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="bodyId"
          [attr.aria-label]="label()"
          (click)="open.set(!open())"
        >
          <span class="chevron" aria-hidden="true"></span>
        </button>
      }
    </div>
    @if (expandable()) {
      <div class="options" [class.is-open]="open()" [id]="bodyId" role="region" [attr.aria-labelledby]="toggleId">
        <div class="inner"><ng-content select="[options]" /></div>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .row__primary {
      flex: 1;
      min-width: 0;
    }
    .toggle {
      display: grid;
      flex: none;
      place-content: center;
      width: 1.6rem;
      height: 1.6rem;
      padding: 0;
      color: var(--khaki);
      background: none;
      border: 0;
      border-radius: var(--radius);
      cursor: pointer;
    }
    .toggle:hover {
      color: var(--smoke-yellow);
    }
    /* A corner of a square: points right when shut and turns to point down as the options open. */
    .chevron {
      width: 0.4rem;
      height: 0.4rem;
      border: solid currentcolor;
      border-width: 0 2px 2px 0;
      transform: rotate(-45deg);
      transition: transform 0.25s ease;
    }
    .toggle[aria-expanded='true'] .chevron {
      transform: rotate(45deg);
    }
    .options {
      display: grid;
      grid-template-rows: 0fr;
      visibility: hidden;
      /* Hidden only once the slide has finished, so it stays visible while it shrinks shut. */
      transition:
        grid-template-rows 0.2s ease,
        visibility 0s linear 0.2s;
    }
    .options.is-open {
      grid-template-rows: 1fr;
      visibility: visible;
      transition: grid-template-rows 0.2s ease;
    }
    .inner {
      min-height: 0;
      overflow: hidden;
      padding: 0.3rem 0 0.1rem 0;
    }
    @media (prefers-reduced-motion: reduce) {
      .options,
      .options.is-open,
      .chevron {
        transition: none;
      }
    }
  `,
})
export class LayerRow {
  /** Read by the arrow button, since it has no visible text of its own: "Incident markers options", for example. */
  readonly label = input.required<string>();
  /** False when the layer has nothing to configure: no arrow, no slide-out. */
  readonly expandable = input(true);

  protected readonly open = signal(false);
  protected readonly toggleId = `layer-row-toggle-${nextId++}`;
  protected readonly bodyId = `layer-row-body-${nextId++}`;
}
