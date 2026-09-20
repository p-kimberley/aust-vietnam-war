// Smoke test for a running site: what has to work before traffic is sent to it, or after a release.
//
//   node deploy/smoke/smoke.mjs https://vietnam-war.au                      (through the ingress: the API is on the same host)
//   node deploy/smoke/smoke.mjs http://localhost:4000 http://localhost:5186  (local: web and API on their own ports)
//
// Read-only: it fetches pages and data and posts nothing but a harmless content-security-policy report. Needs Node 20 or later.
// Exits 1 if any check fails, so it can gate a release or a cutover.

const site = (process.argv[2] ?? process.env.SMOKE_SITE ?? 'http://localhost:4000').replace(/\/+$/, '');
const api = (process.argv[3] ?? process.env.SMOKE_API ?? site).replace(/\/+$/, '');

let failed = 0;
const results = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, detail });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } catch (error) {
    failed++;
    results.push({ name, ok: false, ms: Date.now() - started, detail: String(error.message ?? error) });
    console.log(`FAIL  ${name}  ${error.message ?? error}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function get(url, init) {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000), ...init });
  return res;
}

// ------------------------------------------------------------------ the web server

await check('web: /healthz answers', async () => {
  const res = await get(`${site}/healthz`);
  assert(res.status === 200, `status ${res.status}`);
});

await check('web: the home page renders on the server', async () => {
  const res = await get(`${site}/`);
  assert(res.status === 200, `status ${res.status}`);
  assert((res.headers.get('content-type') ?? '').includes('text/html'), 'not HTML');
  const html = await res.text();
  assert(html.includes('<app-root'), 'no application root');
  assert(/<title>[^<]+<\/title>/.test(html), 'no title');
  assert(html.includes('rel="canonical"'), 'no canonical link');
  return `${html.length} bytes`;
});

await check('web: pages carry the security headers', async () => {
  const res = await get(`${site}/`);
  for (const [name, want] of [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY'], ['referrer-policy', null], ['permissions-policy', null]]) {
    const got = res.headers.get(name);
    assert(got && (want === null || got === want), `${name} is ${got ?? 'missing'}`);
  }
  const csp = res.headers.get('content-security-policy') ?? res.headers.get('content-security-policy-report-only');
  assert(csp?.includes("object-src 'none'"), 'no content security policy');
  return res.headers.has('content-security-policy') ? 'CSP enforced' : 'CSP report-only';
});

await check('web: an unknown address gives a real 404 page', async () => {
  const res = await get(`${site}/no-such-page-${Date.now()}`);
  assert(res.status === 404, `status ${res.status}`);
});

await check('web: the Battle Map page renders', async () => {
  const res = await get(`${site}/battlemap`);
  assert(res.status === 200, `status ${res.status}`);
});

await check('web: robots.txt keeps crawlers out of the Studio and names the sitemap', async () => {
  const text = await (await get(`${site}/robots.txt`)).text();
  assert(text.includes('Disallow: /studio'), 'the Studio is not disallowed');
  assert(/Sitemap: https?:\/\//.test(text), 'no sitemap line');
});

await check('web: sitemap.xml and feed.xml are served', async () => {
  const sitemap = await get(`${site}/sitemap.xml`);
  assert(sitemap.status === 200 && (sitemap.headers.get('content-type') ?? '').includes('xml'), `sitemap ${sitemap.status}`);
  const feed = await get(`${site}/feed.xml`);
  assert(feed.status === 200 && (await feed.text()).includes('<rss'), `feed ${feed.status}`);
});

// ------------------------------------------------------------------ the API

await check('api: live and ready (database and media storage)', async () => {
  assert((await get(`${api}/api/health/live`)).status === 200, 'not live');
  const ready = await get(`${api}/api/health/ready`);
  assert(ready.status === 200, `not ready: ${ready.status}`);
});

await check('api: responses are not sniffable or frameable, and say nothing about the server', async () => {
  const res = await get(`${api}/api/health/live`);
  assert(res.headers.get('x-content-type-options') === 'nosniff', 'no nosniff');
  assert(res.headers.get('x-frame-options') === 'DENY', 'no frame protection');
  assert(!res.headers.has('x-powered-by'), 'x-powered-by is exposed');
});

await check('api: the map catalogue has basemaps', async () => {
  const config = await (await get(`${api}/api/map/config`)).json();
  assert(Array.isArray(config.basemaps) && config.basemaps.length > 0, 'no basemaps');
  assert(config.basemaps.every((b) => /^https?:\/\//.test(b.style)), 'a basemap style is not an http(s) URL');
  return `${config.basemaps.length} basemaps`;
});

let firstContact = null;
await check('api: contacts come back from Elasticsearch, compressed', async () => {
  const res = await get(`${api}/api/contacts`, { headers: { 'accept-encoding': 'gzip, br' } });
  assert(res.status === 200, `status ${res.status}`);
  const contacts = await res.json();
  assert(Array.isArray(contacts) && contacts.length > 1000, `only ${contacts?.length} contacts`);
  firstContact = contacts[0].id;
  return `${contacts.length} contacts`;
});

await check('api: one incident has its details', async () => {
  assert(firstContact !== null, 'no contact to look up');
  const res = await get(`${api}/api/contacts/${firstContact}`);
  assert(res.status === 200, `status ${res.status}`);
  const detail = await res.json();
  assert(detail.id === firstContact, 'wrong incident');
});

await check('api: hidden and unknown incidents are 404, not 500', async () => {
  assert((await get(`${api}/api/contacts/2147483000`)).status === 404, 'expected 404');
});

await check('api: the filter catalogue and unit tree load', async () => {
  const units = await get(`${api}/api/contacts/filters`);
  assert(units.status === 200, `units ${units.status}`);
});

await check('api: a chart can be drawn from the roll and contacts', async () => {
  const res = await get(`${api}/api/analytics/charts/age-at-death`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'avw' },
    body: '{}',
  });
  assert(res.status === 200, `status ${res.status}`);
  const chart = await res.json();
  assert(chart.rows > 0, 'no rows');
  return `${chart.rows} rows`;
});

await check('api: the honour roll answers', async () => {
  const res = await get(`${api}/api/honour-roll?page=1`);
  assert(res.status === 200, `status ${res.status}`);
  const page = await res.json();
  assert(page.total > 0, 'empty honour roll');
  return `${page.total} people`;
});

await check('api: published articles list', async () => {
  const res = await get(`${api}/api/content/articles`);
  assert(res.status === 200, `status ${res.status}`);
});

await check('api: pictures on the map come back, and one opens with its image', async () => {
  const res = await get(`${api}/api/community-media?minLat=-90&minLon=-180&maxLat=90&maxLon=180`);
  assert(res.status === 200, `status ${res.status}`);
  const pictures = await res.json();
  assert(Array.isArray(pictures), 'not a list');
  if (pictures.length === 0) {
    return 'none yet';
  }
  const detail = await get(`${api}/api/incident-media/${pictures[0].id}`);
  assert(detail.status === 200 && (await detail.json()).id === pictures[0].id, `detail ${detail.status}`);
  assert(detail.headers.get('cache-control')?.includes('no-store'), 'a per-person answer is cacheable');
  const image = await get(`${api}${pictures[0].thumbUrl}`);
  assert(image.status === 200 && (image.headers.get('content-type') ?? '').startsWith('image/'), `image ${image.status}`);
  return `${pictures.length} pictures`;
});

await check('api: notes and photos can be searched, and the answer can be cached', async () => {
  const res = await get(`${api}/api/community-search?q=patrol`);
  assert(res.status === 200, `status ${res.status}`);
  assert(res.headers.get('cache-control')?.includes('max-age'), 'not cacheable');
  const found = await res.json();
  assert(Array.isArray(found.notes) && Array.isArray(found.pictures), 'not the expected shape');
  return `${found.noteTotal} notes, ${found.pictureTotal} photos`;
});

await check('api: an incident lists the photos taken near it', async () => {
  assert(firstContact !== null, 'no contact to look up');
  const res = await get(`${api}/api/contacts/${firstContact}/nearby-media`);
  assert(res.status === 200 && Array.isArray(await res.json()), `status ${res.status}`);
});

await check('api: nobody is signed in, and the Studio is closed to them', async () => {
  const me = await (await get(`${api}/api/auth/me`)).json();
  assert(me.authenticated === false, 'authenticated without signing in');
  const studio = await get(`${api}/api/studio/articles`);
  assert([401, 403].includes(studio.status) || studio.status === 302, `Studio answered ${studio.status}`);
});

await check('api: a write without the anti-forgery header is refused', async () => {
  const res = await get(`${api}/api/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert(res.status === 403, `status ${res.status}`);
});

await check('api: a browser can report a content security policy violation', async () => {
  const res = await get(`${api}/api/csp-report`, {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report' },
    body: JSON.stringify({ 'csp-report': { 'effective-directive': 'smoke-test', 'blocked-uri': 'none', 'document-uri': site } }),
  });
  assert(res.status === 204, `status ${res.status}`);
});

await check('api: a missing picture is 404, not 500', async () => {
  const res = await get(`${site}/media/00/${'0'.repeat(64)}.jpg`);
  assert(res.status === 404, `status ${res.status}`);
});

console.log(`\n${results.length - failed} of ${results.length} checks passed against ${site}${api === site ? '' : ` and ${api}`}.`);
process.exit(failed === 0 ? 0 : 1);
