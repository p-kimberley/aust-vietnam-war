import type { StyleSpecification } from 'maplibre-gl';

/** The site's smoke yellow (styles.scss): the ring on a dark or busy basemap. */
export const SELECTION_YELLOW = '#e3b92e';

/** A basemap with less colour than this is grey, with no hue of its own to stand against. */
const GREY = 0.12;
/** The hue used against a grey light basemap: a cobalt blue, apart from the markers' red. */
const COBALT = 215;

/**
 * The colour of the ring round the open incident (and its ripple, and the reticule that first points it out), chosen to stand
 * out on the basemap in use. On a dark one, or on imagery (dark and busy), the site's yellow. On a light one, a deep, strong
 * colour opposite the basemap's own hue (a blue on the beige maps); on a light grey one, cobalt. The basemap is judged by its
 * style's bottom layer: its background colour, or raster imagery.
 */
export function selectionColour(style: StyleSpecification | undefined): string {
  const base = style?.layers?.[0];
  if (!base || base.type !== 'background') {
    return SELECTION_YELLOW;
  }
  const colour = base.paint?.['background-color'];
  const rgb = typeof colour === 'string' ? parseColour(colour) : null;
  if (!rgb) {
    return SELECTION_YELLOW;
  }
  const { h, s, l } = toHsl(rgb);
  if (l < 0.5) {
    return SELECTION_YELLOW;
  }
  const hue = s < GREY ? COBALT : (h + 180) % 360;
  return `hsl(${Math.round(hue)}, 85%, 34%)`;
}

type Rgb = readonly [r: number, g: number, b: number];

/** A CSS colour as a style writes one (#rgb, #rrggbb, rgb(), rgba(), hsl(), hsla()), as red, green and blue in 0..255; else null. */
export function parseColour(text: string): Rgb | null {
  const c = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/.exec(c);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as unknown as Rgb;
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(c);
  if (!fn) {
    return null;
  }
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean).map((p) => parseFloat(p));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) {
    return null;
  }
  if (fn[1].startsWith('rgb')) {
    return [parts[0], parts[1], parts[2]];
  }
  return fromHsl(parts[0], parts[1] / 100, parts[2] / 100);
}

function toHsl([r, g, b]: Rgb): { h: number; s: number; l: number } {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) {
    return { h: 0, s: 0, l };
  }
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rr ? ((gg - bb) / d + 6) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return { h: h * 60, s, l };
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
