// Generates Mapbox-style SDF glyph ranges (.pbf) from TrueType fonts, for the ranges the map needs.
// Run inside a container with `fontnik` installed:  node gen-glyphs.js /fonts-in /glyphs-out
const fs = require('fs');
const path = require('path');
const fontnik = require('fontnik');

const [inDir, outDir] = process.argv.slice(2);

// Basic Latin and Latin-1, Latin Extended-A/B, IPA/spacing, combining marks, Latin Extended Additional (all the
// Vietnamese precomposed letters), general punctuation, and currency/letterlike symbols. Other scripts (Khmer, Thai,
// CJK) fall back to the Noto Sans fonts already on the tile server.
const starts = [0, 256, 512, 768, 7680, 8192, 8448];

const load = (buffer) => new Promise((resolve, reject) => fontnik.load(buffer, (e, faces) => (e ? reject(e) : resolve(faces))));
const range = (opts) => new Promise((resolve, reject) => fontnik.range(opts, (e, data) => (e ? reject(e) : resolve(data))));

(async () => {
  for (const file of fs.readdirSync(inDir).filter((f) => /\.(ttf|otf)$/i.test(f)).sort()) {
    const buffer = fs.readFileSync(path.join(inDir, file));
    const faces = await load(buffer);
    for (const face of faces) {
      // The stack name a style uses is "<family> <style>", the same rule TileServer GL applies.
      const name = `${face.family_name} ${face.style_name}`.trim();
      const dir = path.join(outDir, name);
      fs.mkdirSync(dir, { recursive: true });
      let files = 0;
      for (const start of starts) {
        const end = start + 255;
        const data = await range({ font: buffer, start, end });
        fs.writeFileSync(path.join(dir, `${start}-${end}.pbf`), data);
        files++;
      }
      console.log(`${name}: ${files} ranges, ${face.points ? face.points.length : '?'} glyphs listed`);
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
