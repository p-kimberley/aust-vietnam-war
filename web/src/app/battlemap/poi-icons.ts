import type { Map } from 'maplibre-gl';

/*
 * The symbols for points of interest, in the language of the mockups' "Map symbols" style guide: a solid triangle for a
 * fire support base, a starred square for a base. They are drawn on a canvas at start-up rather than shipped as image
 * files, so they need no requests, follow the style guide's colours and are sharp on high-density screens.
 * Map images cannot read CSS variables, so the colours are repeated from styles.scss.
 */
const INK = '#22251a';
const PAPER = '#efe7cc';
const SMOKE_YELLOW = '#e3b92e';
const BRASS = '#c99a3b';
const FRIENDLY_BLUE = '#2f5f86';

/** The image each point type is drawn with; anything not listed is drawn as a flag. */
export const POI_ICON_BY_TYPE: Readonly<Record<string, string>> = {
  FSB: 'avw-poi-fsb',
  FSPB: 'avw-poi-fspb',
  LZ: 'avw-poi-lz',
  Base: 'avw-poi-base',
};
export const POI_ICON_OTHER = 'avw-poi-other';

/** Each icon is drawn in a box of 24 units centred on the origin; the shapes stay within 9 units of it. */
const BOX = 24;
const PIXEL_RATIO = 2;

/** Outlines every shape in paper first, so a dark symbol still reads on the dark basemaps. */
function halo(ctx: CanvasRenderingContext2D, shape: Path2D): void {
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.4;
  ctx.strokeStyle = PAPER;
  ctx.stroke(shape);
}

type Draw = (ctx: CanvasRenderingContext2D) => void;

const ICONS: readonly { id: string; draw: Draw }[] = [
  {
    // A solid triangle, as in the style guide.
    id: POI_ICON_BY_TYPE['FSB'],
    draw: (ctx) => {
      const triangle = new Path2D('M0-9 9.5 8-9.5 8Z');
      halo(ctx, triangle);
      ctx.fillStyle = INK;
      ctx.fill(triangle);
    },
  },
  {
    // The same triangle, open: a patrol base is the lighter, temporary cousin of a fire support base.
    id: POI_ICON_BY_TYPE['FSPB'],
    draw: (ctx) => {
      const triangle = new Path2D('M0-8.5 9 7.5-9 7.5Z');
      halo(ctx, triangle);
      ctx.fillStyle = PAPER;
      ctx.fill(triangle);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = INK;
      ctx.stroke(triangle);
    },
  },
  {
    // A helicopter pad: an "H" on a blue disc.
    id: POI_ICON_BY_TYPE['LZ'],
    draw: (ctx) => {
      const disc = new Path2D();
      disc.arc(0, 0, 9, 0, Math.PI * 2);
      halo(ctx, disc);
      ctx.fillStyle = FRIENDLY_BLUE;
      ctx.fill(disc);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke(disc);
      ctx.fillStyle = PAPER;
      ctx.fillRect(-4.2, -5, 2.2, 10);
      ctx.fillRect(2, -5, 2.2, 10);
      ctx.fillRect(-4.2, -1.1, 8.4, 2.2);
    },
  },
  {
    // An ink square with a smoke-yellow star, as in the style guide's "Base or town".
    id: POI_ICON_BY_TYPE['Base'],
    draw: (ctx) => {
      const square = new Path2D();
      square.rect(-8, -8, 16, 16);
      halo(ctx, square);
      ctx.fillStyle = INK;
      ctx.fill(square);
      ctx.fillStyle = SMOKE_YELLOW;
      ctx.fill(new Path2D('M0-4l1.7 3.5 3.8.4-2.8 2.6.8 3.8L0 4.2l-3.5 2 .8-3.8-2.8-2.6 3.8-.4z'));
    },
  },
  {
    // A pennant on a pole, for anything else worth marking.
    id: POI_ICON_OTHER,
    draw: (ctx) => {
      const pole = new Path2D();
      pole.rect(-6.5, -9, 2, 18);
      const flag = new Path2D('M-4.5-9 8.5-4.5-4.5 0Z');
      halo(ctx, pole);
      halo(ctx, flag);
      ctx.fillStyle = INK;
      ctx.fill(pole);
      ctx.fillStyle = BRASS;
      ctx.fill(flag);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.stroke(flag);
    },
  },
];

/** The ids of every point icon, for checking what a layer may ask for. */
export const POI_ICON_IDS: readonly string[] = ICONS.map((i) => i.id);

function render(draw: Draw): ImageData | null {
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') {
    return null;
  }
  const size = BOX * PIXEL_RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.translate(size / 2, size / 2);
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  draw(ctx);
  return ctx.getImageData(0, 0, size, size);
}

/**
 * Registers the point icons with the map. Switching basemap discards every image along with the style, so this runs
 * after each style load, like the layers that use them; an icon already present is left alone.
 */
export function addPoiIcons(map: Map): void {
  for (const icon of ICONS) {
    if (map.hasImage(icon.id)) {
      continue;
    }
    const image = render(icon.draw);
    if (image) {
      map.addImage(icon.id, image, { pixelRatio: PIXEL_RATIO });
    }
  }
}
