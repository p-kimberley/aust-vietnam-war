# Map fonts for the vintage style

Three open-licence (SIL OFL 1.1) families, chosen because they cover **every Vietnamese letter** (most fonts with a
period feel, such as Courier Prime and Stardos Stencil, are missing about 80% of the Vietnamese diacritics, which would
leave holes in nearly every place name).

| Family | Faces used | Used for |
|---|---|---|
| Noto Serif | Regular, Bold, Italic, Bold Italic | town, village and city names; districts and water in italics |
| IBM Plex Mono | Regular, Bold, Italic | road names, road numbers, contour heights (a typewriter feel) |
| Saira Stencil One | Regular | province and country names (military stencil) |

Each label's font stack ends with a Noto Sans face that is already on the tile server, so scripts these fonts do not
cover (Khmer, for the Cambodian side of the map) still draw.

## Install on TileServer GL

The style asks for the stacks by name: `Noto Serif Regular`, `Noto Serif Bold`, `Noto Serif Italic`,
`IBM Plex Mono Regular`, `IBM Plex Mono Bold`, `IBM Plex Mono Italic` and `Saira Stencil One Regular`. Install either
form in the tile server's fonts directory (the same place as `Noto Sans Regular`):

- **Pre-built glyphs (works with every version):** copy each folder in `glyphs/` (for example `glyphs/Noto Serif Regular`)
  into the fonts directory, keeping the folder name. Each holds `0-255.pbf`, `256-511.pbf` and so on.
- **Font files:** recent TileServer GL versions build glyphs from `.ttf` files placed in the fonts directory. The files
  are in `ttf/`. If your version does this, you do not need `glyphs/`.

Restart TileServer GL, then check `/fonts.json` lists the seven new names. The glyph ranges cover Basic Latin, Latin-1,
Latin Extended A and B, combining marks, Latin Extended Additional (all the Vietnamese precomposed letters), general
punctuation and the symbol blocks. Everything else falls back to Noto Sans.

## Licences

The fonts are redistributed under the SIL Open Font License 1.1; the licence texts are in `licences/`. The OFL allows
bundling and use in maps and applications, requires the licence to accompany the fonts, and forbids selling the fonts on
their own.

## Regenerating

`gen-glyphs.js` builds the glyph ranges with [fontnik](https://github.com/mapbox/fontnik) (which needs a recent glibc, so
a container is easiest):

```
docker run --rm -v <work dir>:/work -w /work node:20-bookworm bash -c \
  "mkdir /tmp/g && cd /tmp/g && npm init -y && npm i fontnik && cp /work/gen-glyphs.js . && node gen-glyphs.js /work/ttf /work/glyphs"
```

The folder name for each face is `<family name> <style name>` read from the font, which is the name TileServer GL
uses.
