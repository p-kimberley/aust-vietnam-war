"""
Builds the home page banner's backdrop images from the source photographs.

    python web/scripts/build-home-backdrops.py [source folder]

The source folder defaults to .ai/site-home-images (git-ignored; the originals are not in the repository). Each photograph is
trimmed of any scan border, cropped to the banner's shape around its subject, and toned to the site's palette: a duotone that
runs from the darkest olive to paper, through a warm olive middle, so that it sits with the rest of the site whatever the
original's colour. Detail is kept by lifting local contrast before toning and by a light sharpen after it. Each is written at
two widths to web/public/home/, as `<name>-1920.jpg` and `<name>-960.jpg`.

Needs Pillow. The list below is what the home page shows, in order; add a photograph by adding it here and to home.ts.
"""

import sys
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'web' / 'public' / 'home'

# The banner is wide and short; this is its shape at desktop width, a touch taller so a narrower screen still has room.
ASPECT = 2.2
WIDTHS = (1920, 960)

# The site's palette (styles.css): the shadows, the middle and the highlights of the duotone.
SHADOW = '#1a1d10'
MIDDLE = '#6b6a44'
HIGHLIGHT = '#efe7cc'

# name out, source file, where the subject is (fractions across and down) for the crop, and any margin the automatic trim
# misses (fractions off the left, top, right and bottom: a border with marks on it does not look plain).
PHOTOS = [
    ('patrol', '20150507adfa3443372_155.jpg', (0.45, 0.30), (0, 0, 0, 0)),
    ('jungle-armour', 'COM_69~1.jpg', (0.52, 0.45), (0, 0, 0, 0)),
    ('fsb-ziggy', 'Fire Support Base Ziggy.jpg', (0.55, 0.50), (0, 0, 0.05, 0.02)),
    ('long-hais-centurions', 'Isa (at the foot of the Long Hais) -Target practice for Centurion tanks.jpg', (0.40, 0.55), (0, 0, 0, 0)),
    ('hammersley', 'Op. Hammersley Feb 1970 - After the B52 strike- troops go back in..jpg', (0.50, 0.58), (0, 0, 0, 0)),
]


def trim_border(im: Image.Image) -> Image.Image:
    """Cuts off plain white or black strips at the edges (a scanned print's margin, a slide mount's shadow)."""
    grey = ImageOps.grayscale(im)
    w, h = grey.size
    px = grey.load()

    def plain(values: list[int]) -> bool:
        mean = sum(values) / len(values)
        spread = sum((v - mean) ** 2 for v in values) / len(values)
        return (mean > 225 or mean < 30) and spread < 400

    col = lambda x: [px[x, y] for y in range(0, h, 4)]
    row = lambda y: [px[x, y] for x in range(0, w, 4)]
    left, right, top, bottom = 0, w - 1, 0, h - 1
    limit_x, limit_y = w // 8, h // 8
    while left < limit_x and plain(col(left)):
        left += 1
    while w - 1 - right < limit_x and plain(col(right)):
        right -= 1
    while top < limit_y and plain(row(top)):
        top += 1
    while h - 1 - bottom < limit_y and plain(row(bottom)):
        bottom -= 1
    # A little more, for the soft edge a border leaves behind.
    pad = 4 if (left, top, right, bottom) != (0, 0, w - 1, h - 1) else 0
    return im.crop((left + pad if left else 0, top + pad if top else 0, right - pad + 1 if right < w - 1 else w, bottom - pad + 1 if bottom < h - 1 else h))


def crop_to_banner(im: Image.Image, focus: tuple[float, float]) -> Image.Image:
    """The largest banner-shaped piece of the photograph, centred as near the subject as the edges allow."""
    w, h = im.size
    if w / h > ASPECT:
        cw, ch = round(h * ASPECT), h
    else:
        cw, ch = w, round(w / ASPECT)
    x = min(max(round(focus[0] * w - cw / 2), 0), w - cw)
    y = min(max(round(focus[1] * h - ch / 2), 0), h - ch)
    return im.crop((x, y, x + cw, y + ch))


def tone(im: Image.Image) -> Image.Image:
    """The site's duotone, with local contrast lifted first so that texture (foliage, sandbags, faces) survives it."""
    grey = ImageOps.grayscale(im)
    grey = ImageOps.autocontrast(grey, cutoff=(1, 1))
    # Local contrast: an unsharp mask with a wide radius brings out form without the halo a small one would draw.
    grey = grey.filter(ImageFilter.UnsharpMask(radius=40, percent=35, threshold=0))
    return ImageOps.colorize(grey, black=SHADOW, white=HIGHLIGHT, mid=MIDDLE)


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '.ai' / 'site-home-images'
    OUT.mkdir(parents=True, exist_ok=True)
    for name, file, focus, margin in PHOTOS:
        photo = Image.open(source / file).convert('RGB')
        w, h = photo.size
        photo = photo.crop((round(margin[0] * w), round(margin[1] * h), w - round(margin[2] * w), h - round(margin[3] * h)))
        banner = tone(crop_to_banner(trim_border(photo), focus))
        for width in WIDTHS:
            # Never enlarged: a small original is served at its own size and the browser scales it.
            out = banner if banner.width <= width else banner.resize((width, round(width / banner.width * banner.height)), Image.LANCZOS)
            out = out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
            path = OUT / f'{name}-{width}.jpg'
            out.save(path, 'JPEG', quality=80, optimize=True, progressive=True)
            print(f'{path.relative_to(ROOT)}  {out.width}x{out.height}  {path.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
