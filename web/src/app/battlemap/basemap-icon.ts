import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The colours that make a basemap recognisable at a glance. SVG attributes cannot read CSS variables, so they are repeated here. */
interface Palette {
  land: string;
  water: string;
  /** A main road, its outline, and a minor road. */
  road: string;
  casing: string;
  minor: string;
  /** Contour lines, drawn only on the basemaps that show relief. */
  contour: string | null;
}

/** Keyed by the basemap's id in the deployment's configuration. */
const PALETTES: Readonly<Record<string, Palette>> = {
  // Aged paper, rust roads and pale sepia contours, like the style guide's basemap swatches.
  vintage: { land: '#e8e0bf', water: '#a9c7c6', road: '#a6472f', casing: '#7d3422', minor: '#b9ac80', contour: '#b9ac80' },
  terrain: { land: '#cbd6a0', water: '#a9c7c6', road: '#fbf6e4', casing: '#a39a6e', minor: '#e3dcb9', contour: '#8f9a63' },
  bright: { land: '#f1eadb', water: '#9dc8e8', road: '#f6c451', casing: '#d9a52c', minor: '#ffffff', contour: null },
  positron: { land: '#f0f0ee', water: '#cfd8dc', road: '#ffffff', casing: '#cfcfca', minor: '#ffffff', contour: null },
  'dark-matter': { land: '#2a2e35', water: '#12151a', road: '#464c56', casing: '#1a1d22', minor: '#363b43', contour: null },
  // Photographic, not styled: muted greens and a dusty track rather than a drawn road, since imagery shows no cartography of its own.
  satellite: { land: '#4f5a3a', water: '#1c2a38', road: '#8a8562', casing: '#3a4128', minor: '#6b7350', contour: null },
};

/** Neutral colours for a basemap the icons do not know, so a newly configured one still gets a picture. */
const GENERIC: Palette = { land: '#e6e2d3', water: '#b9cdd8', road: '#ffffff', casing: '#b5b0a0', minor: '#f4f1e8', contour: null };

/**
 * A tiny abstract map (land, a river or coast, two roads and, for relief basemaps, contour lines) in the colours of the
 * basemap it stands for: a picture of the look, not of any real place.
 */
@Component({
  selector: 'app-basemap-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 40 28" width="40" height="28" aria-hidden="true" focusable="false">
      <rect width="40" height="28" [attr.fill]="palette().land" />
      @if (palette().contour; as contour) {
        <g fill="none" [attr.stroke]="contour" stroke-width="0.8">
          <path d="M2 9C7 3 15 3 19 8" />
          <path d="M5 11C9 7 14 7 16 10" />
          <path d="M23 6C29 1 36 3 38 9" />
          <path d="M26 8C30 5 34 6 35 9" />
        </g>
      }
      <path d="M0 21C8 16 14 25 22 22S34 15 40 18V28H0Z" [attr.fill]="palette().water" />
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 -2C17 8 12 15 16 22" [attr.stroke]="palette().minor" stroke-width="1.5" />
        <path d="M-2 11C9 6 17 13 26 10S37 5 42 7" [attr.stroke]="palette().casing" stroke-width="4" />
        <path d="M-2 11C9 6 17 13 26 10S37 5 42 7" [attr.stroke]="palette().road" stroke-width="2.4" />
      </g>
      <rect x="0.5" y="0.5" width="39" height="27" rx="2.5" fill="none" stroke="#22251a" stroke-opacity="0.5" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    svg {
      display: block;
      overflow: hidden;
      border-radius: 3px;
    }
  `,
})
export class BasemapIcon {
  /** The basemap's id. */
  readonly id = input.required<string>();

  protected readonly palette = computed(() => PALETTES[this.id()] ?? GENERIC);
}
