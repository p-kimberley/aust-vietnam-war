import { ChangeDetectionStrategy, Component } from '@angular/core';

let nextId = 0;

/**
 * A remembrance poppy, drawn as the site icon's is (public/icon-small.svg): four broad, overlapping petals, the two behind
 * darker, deepening towards a dark centre ringed with stamens, with a fold across each petal and light on the front ones' edges.
 * Sized to the text beside it (1em), unless its host is sized.
 */
@Component({
  selector: 'app-poppy',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 32 32" focusable="false">
      <defs>
        <!-- Each poppy has its own shading, as one drawn in a hidden panel cannot lend its shading to another. -->
        <radialGradient [attr.id]="id + 'b'" gradientUnits="userSpaceOnUse" cx="16" cy="16" r="16">
          <stop offset="0.2" stop-color="#5e1a0f" />
          <stop offset="1" stop-color="#9a2c1b" />
        </radialGradient>
        <radialGradient [attr.id]="id + 'f'" gradientUnits="userSpaceOnUse" cx="16" cy="16" r="16">
          <stop offset="0.2" stop-color="#8f2818" />
          <stop offset="0.75" stop-color="#c23a26" />
          <stop offset="1" stop-color="#d4492f" />
        </radialGradient>
      </defs>
      <!-- The petals behind, then in front. -->
      <g [attr.fill]="'url(#' + id + 'b)'">
        <circle cx="11" cy="11" r="8.6" />
        <circle cx="21" cy="21" r="8.6" />
      </g>
      <g [attr.fill]="'url(#' + id + 'f)'">
        <circle cx="21" cy="11" r="8.6" />
        <circle cx="11" cy="21" r="8.6" />
      </g>
      <!-- A fold down each front petal, and the light on their outer edges. -->
      <g fill="none" stroke-linecap="round">
        <path d="M18.6 13.4Q22 10.4 25.6 6.8M13.4 18.6Q10.4 22 6.8 25.6" stroke="#7a2213" stroke-width="0.8" opacity="0.6" />
        <path d="M24.2 4.1A7.2 7.2 0 0 1 27.9 7.8M4.1 24.2A7.2 7.2 0 0 0 7.8 27.9" stroke="#ea7556" stroke-width="1.2" opacity="0.9" />
      </g>
      <!-- The centre, ringed with stamens. -->
      <g fill="#15170e">
        <circle cx="16" cy="16" r="3.3" />
        <circle cx="16" cy="11.5" r="0.75" />
        <circle cx="19.2" cy="12.8" r="0.75" />
        <circle cx="20.5" cy="16" r="0.75" />
        <circle cx="19.2" cy="19.2" r="0.75" />
        <circle cx="16" cy="20.5" r="0.75" />
        <circle cx="12.8" cy="19.2" r="0.75" />
        <circle cx="11.5" cy="16" r="0.75" />
        <circle cx="12.8" cy="12.8" r="0.75" />
      </g>
      <circle cx="15.1" cy="15.1" r="1.1" fill="#3a3d26" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-block;
      flex: none;
      width: 1em;
      height: 1em;
      vertical-align: -0.15em;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
  `,
})
export class Poppy {
  protected readonly id = `poppy-${nextId++}-`;
}
