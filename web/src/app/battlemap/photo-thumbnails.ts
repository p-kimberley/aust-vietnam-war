import type { Map } from 'maplibre-gl';

/** Every thumbnail on the map is an image named `avw-photo-<picture id>`. */
export const PHOTO_IMAGE_PREFIX = 'avw-photo-';

// Colours match the style guide tokens in styles.scss; images drawn for the map cannot read CSS variables.
const INK = '#22251a';
const PAPER = '#efe7cc';

/** How big a thumbnail is on the map: the long edge of the picture, in pixels, before its frame. */
export const PHOTO_THUMB_PX = 50;
/** The drawing is made at twice that, so it is sharp on a high-density screen. */
const PIXEL_RATIO = 2;
const BORDER = 3;
const SHADOW = 3;

/** The one pixel that stands in for a thumbnail that could not be loaded, so the map does not keep asking for it. */
const BLANK = { width: 1, height: 1, data: new Uint8Array(4) };

/** The pictures already drawn, by the address of their thumbnail, and those being fetched now. */
const drawn: Record<string, ImageData | undefined> = {};
const pending: Record<string, Promise<ImageData | null> | undefined> = {};
/** For each map, the thumbnail address of each picture, kept up to date as the pictures change. */
const addresses = new WeakMap<object, Record<number, string>>();

/**
 * Draws a thumbnail for the map: the picture scaled to {@link PHOTO_THUMB_PX} on its long edge, in a paper mount with a thin
 * ink edge and a soft shadow, like a print. The picture is in the middle of the drawing, which is what the map centres on its
 * place. `null` where there is no canvas.
 */
export function frameThumbnail(picture: { image: CanvasImageSource; width: number; height: number }): ImageData | null {
  if (typeof document === 'undefined' || !picture.width || !picture.height) {
    return null;
  }
  const scale = (PHOTO_THUMB_PX * PIXEL_RATIO) / Math.max(picture.width, picture.height);
  const width = Math.round(picture.width * scale);
  const height = Math.round(picture.height * scale);
  const border = BORDER * PIXEL_RATIO;
  const margin = SHADOW * PIXEL_RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = width + 2 * (border + margin);
  canvas.height = height + 2 * (border + margin);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.shadowColor = 'rgba(20, 22, 10, 0.55)';
  ctx.shadowBlur = margin;
  ctx.shadowOffsetY = PIXEL_RATIO;
  ctx.fillStyle = PAPER;
  ctx.fillRect(margin, margin, width + 2 * border, height + 2 * border);
  ctx.shadowColor = 'transparent';
  ctx.drawImage(picture.image, margin + border, margin + border, width, height);
  ctx.lineWidth = PIXEL_RATIO;
  ctx.strokeStyle = INK;
  ctx.strokeRect(margin + PIXEL_RATIO / 2, margin + PIXEL_RATIO / 2, width + 2 * border - PIXEL_RATIO, height + 2 * border - PIXEL_RATIO);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Fetches a thumbnail and draws it for the map. Each address is fetched once, however many maps or style changes ask. */
function loadThumbnail(url: string): Promise<ImageData | null> {
  const done = drawn[url];
  if (done) {
    return Promise.resolve(done);
  }
  return (pending[url] ??= new Promise<ImageData | null>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const data = frameThumbnail({ image, width: image.naturalWidth, height: image.naturalHeight });
      if (data) {
        drawn[url] = data;
      }
      delete pending[url];
      resolve(data);
    };
    image.onerror = () => {
      delete pending[url];
      resolve(null);
    };
    image.src = url;
  }));
}

/**
 * Lets the map draw the pictures' thumbnails. The map asks for an image by name when a layer first needs it, which for these
 * layers is only for the pictures in view and only from the zoom at which they show, so a thumbnail is fetched when it is about
 * to be seen and not before. Switching basemap discards every image, and they are drawn again from what was kept.
 */
export function registerPhotoThumbnails(map: Map, pictures: readonly { id: number; thumbUrl: string }[]): void {
  const known = addresses.get(map) ?? {};
  for (const p of pictures) {
    known[p.id] = p.thumbUrl;
  }
  if (addresses.has(map)) {
    return;
  }
  addresses.set(map, known);
  map.on('styleimagemissing', (e: { id: string }) => {
    const match = new RegExp(`^${PHOTO_IMAGE_PREFIX}(\\d+)$`).exec(e.id);
    if (!match) {
      return;
    }
    const url = known[Number(match[1])];
    void (url ? loadThumbnail(url) : Promise.resolve(null)).then((data) => {
      if (!map.hasImage(e.id)) {
        map.addImage(e.id, data ?? BLANK, data ? { pixelRatio: PIXEL_RATIO } : undefined);
      }
    });
  });
}
