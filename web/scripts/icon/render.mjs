// Renders the site icon's PNG sizes with Chrome (see README.md beside this file).
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const web = fileURLToPath(new URL('../..', import.meta.url)).replace(/[/\\]+$/, '');
const full = readFileSync(`${web}/public/icon.svg`, 'utf8');
const small = readFileSync(`${web}/scripts/icon/small.svg`, 'utf8');
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const p = await b.newPage();
async function render(svg, size, out, square = false) {
  await p.setViewport({ width: size, height: size });
  // A square, edge-to-edge tile for Apple (it rounds the corners itself).
  const s = square ? svg.replace(/rx="12"/, 'rx="0"').replace(/<rect x="3"[^>]*\/>/, '<rect x="3" y="3" width="58" height="58" rx="0" fill="none" stroke="#c99a3b" stroke-width="2.5"/>') : svg;
  await p.setContent(`<html><body style="margin:0;background:transparent">${s.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
for (const n of [16, 32, 48]) await render(small, n, `${web}/scripts/icon/ico-${n}.png`);
await render(full, 180, `${web}/public/apple-touch-icon.png`, true);
await render(full, 192, `${web}/public/icon-192.png`);
await render(full, 512, `${web}/public/icon-512.png`);
await b.close();
