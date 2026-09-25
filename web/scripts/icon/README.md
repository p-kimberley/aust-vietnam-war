# The site icon

The outline of Vietnam with a remembrance poppy over Phuoc Tuy province, where the Australian Task Force was based at Nui Dat
(nudged just out over the coast so the Mekong Delta still shows), in the site's colours (`styles.css`).

- `build-svg.py` draws both SVGs from `vietnam-ne50m.json`, Natural Earth's 1:50m border of Vietnam (public domain; only the
  mainland is drawn, simplified to suit the size).
- `public/icon.svg` is the icon itself, for browsers that take an SVG icon, and the source of the larger PNGs.
- `small.svg` (here) is a bolder version with a larger poppy and a plainer outline, for 16 to 48 pixels.
- `public/favicon.ico` holds `small.svg` at 16, 32 and 48 pixels; `apple-touch-icon.png` (180, square: iOS rounds it),
  `icon-192.png` and `icon-512.png` (for `site.webmanifest`) are `icon.svg`.

To make them again (after changing `build-svg.py`):

```
cd web
python scripts/icon/build-svg.py
npm i --no-save puppeteer-core@24                  # only for this; package.json is left alone
node scripts/icon/render.mjs                        # CHROME=<path to Chrome> if it is not in the usual place
python -c "from PIL import Image; ims=[Image.open(f'scripts/icon/ico-{n}.png').convert('RGBA') for n in (16,32,48)]; ims[2].save('public/favicon.ico', sizes=[(16,16),(32,32),(48,48)], append_images=ims[:2])"
rm scripts/icon/ico-*.png
```
