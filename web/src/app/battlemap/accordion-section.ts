import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

let nextId = 0;

/**
 * One section of an accordion: a heading that is a button, and a body that slides open and shut. It owns no state: the
 * parent says which section is open and hears when the heading is pressed, so it can close the others.
 *
 * The body is animated by growing its grid row from 0fr to 1fr, which works for any content height in every current
 * browser. Closed, it is `visibility: hidden` (after the slide), so nothing in it can be tabbed to or read out.
 */
@Component({
  selector: 'app-accordion-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="head">
      <button
        type="button"
        class="toggle"
        [id]="id + '-head'"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="id + '-body'"
        (click)="toggled.emit()"
      >
        <span class="chevron" aria-hidden="true"></span>
        <span>{{ heading() }}</span>
        @if (badge()) {
          <!-- A real space, so the heading and the count are read as two words. -->
          {{ ' ' }}<span class="badge">{{ badge() }}</span>
        }
      </button>
    </h3>
    <div class="body" [class.is-open]="open()" [id]="id + '-body'" role="region" [attr.aria-labelledby]="id + '-head'">
      <div class="inner">
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      border-top: 1px solid var(--olive-700);
    }
    .head {
      margin: 0;
      font: inherit;
      letter-spacing: normal;
      text-transform: none;
    }
    .toggle {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      padding: 0.45rem 0;
      color: var(--smoke-yellow);
      font-family: var(--font-display);
      font-size: 0.9rem;
      text-align: left;
      background: none;
      border: 0;
      cursor: pointer;
    }
    .toggle:hover {
      color: var(--brass);
    }
    /* A corner of a square: points right when shut and turns to point down as the section opens. */
    .chevron {
      flex: none;
      width: 0.45rem;
      height: 0.45rem;
      margin: 0 0.15rem 0.1rem 0.1rem;
      border: solid currentcolor;
      border-width: 0 2px 2px 0;
      transform: rotate(-45deg);
      transition: transform 0.25s ease;
    }
    .toggle[aria-expanded='true'] .chevron {
      transform: rotate(45deg);
    }
    .badge {
      min-width: 1.2rem;
      padding: 0 0.3rem;
      color: var(--ink);
      font-family: var(--font-data);
      font-size: 0.72rem;
      text-align: center;
      background: var(--brass);
      border-radius: 999px;
    }
    .body {
      display: grid;
      grid-template-rows: 0fr;
      visibility: hidden;
      /* Hidden only once the slide has finished, so the closing section stays visible while it shrinks. */
      transition:
        grid-template-rows 0.25s ease,
        visibility 0s linear 0.25s;
    }
    .body.is-open {
      grid-template-rows: 1fr;
      visibility: visible;
      transition:
        grid-template-rows 0.25s ease,
        visibility 0s;
    }
    .inner {
      min-height: 0;
      overflow: hidden;
    }
    @media (prefers-reduced-motion: reduce) {
      .body,
      .body.is-open,
      .chevron {
        transition: none;
      }
    }
  `,
})
export class AccordionSection {
  readonly heading = input.required<string>();
  /** A short mark beside the heading, such as how many filters are set in the section. */
  readonly badge = input<string | number | null>(null);
  readonly open = input(false);
  /** The heading was pressed. */
  readonly toggled = output<void>();

  protected readonly id = `acc-${nextId++}`;
}
