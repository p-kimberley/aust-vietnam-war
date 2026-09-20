// Browser checks for a running site, in a real Chrome: accessibility (axe-core, WCAG 2.2 AA), content security policy
// violations, console errors and whether the map draws. Complements smoke.mjs, which does not run a browser.
//
//   npm install --no-save puppeteer-core axe-core
//   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node deploy/smoke/browser-checks.mjs https://vietnam-war.au
//   node deploy/smoke/browser-checks.mjs http://localhost:4000 --api http://localhost:5186   (local: send /api/ calls to the API's own port)
//
// Signed-out pages only. The Studio, and what a signed-in member sees, need a person to test (see docs/runbook.md).
// Exits 1 if anything is found.

import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const site = (args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:4000').replace(/\/+$/, '');
const apiIndex = args.indexOf('--api');
const apiProxy = apiIndex >= 0 ? args[apiIndex + 1].replace(/\/+$/, '') : null;

const { default: puppeteer } = await import('puppeteer-core');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf-8');
const chrome =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('Set CHROME_PATH to a Chrome or Chromium executable.');
  process.exit(2);
}

const pages = [
  { name: 'home', url: '/' },
  { name: 'stories', url: '/articles' },
  { name: 'feedback form', url: '/feedback' },
  { name: 'not found', url: '/no-such-page' },
  { name: 'battle map', url: '/battlemap?at=10.6,107.2,10', map: true },
  { name: 'battle map with an incident and the charts', url: '/battlemap?at=10.6,107.2,10&incident=1000&charts=1', map: true },
];

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  defaultViewport: { width: 1400, height: 900 },
});

let problems = 0;
for (const { name, url, map } of pages) {
  const page = await browser.newPage();
  const found = [];
  await page.evaluateOnNewDocument(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.effectiveDirective} blocked ${e.blockedURI.slice(0, 100)}`));
  });
  page.on('pageerror', (e) => found.push(`script error: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => {
    // A 404 for a resource is reported by Chrome without a URL here; the response listener below names it.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) found.push(`console error: ${m.text().slice(0, 160)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) found.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
  if (apiProxy) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = new URL(req.url());
      return u.origin === new URL(site).origin && u.pathname.startsWith('/api/') ? req.continue({ url: apiProxy + u.pathname + u.search }) : req.continue();
    });
  }
  await page.goto(site + url, { waitUntil: 'networkidle2', timeout: 60_000 });
  if (map) {
    const drawn = await page.waitForSelector('canvas.maplibregl-canvas', { timeout: 25_000 }).then(() => true).catch(() => false);
    if (!drawn) found.push('the map did not draw');
    await new Promise((r) => setTimeout(r, 6000));
  } else {
    await new Promise((r) => setTimeout(r, 1000));
  }

  for (const v of await page.evaluate(() => window.__csp)) found.push(`content security policy: ${v}`);
  await page.evaluate(axeSource);
  const axe = await page.evaluate(async () => {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return r.violations.map((v) => `[${v.impact}] ${v.id} x${v.nodes.length}: ${v.help} (${v.nodes[0].target.join(' ')})`);
  });
  for (const v of axe) found.push(`accessibility ${v}`);

  console.log(`${found.length === 0 ? 'PASS' : 'FAIL'}  ${name}`);
  for (const f of found) console.log(`      ${f}`);
  problems += found.length;
  await page.close();
}

await browser.close();
console.log(problems === 0 ? '\nNo problems found.' : `\n${problems} problem(s) found.`);
process.exit(problems === 0 ? 0 : 1);
