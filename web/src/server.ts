import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join, sep } from 'node:path';
import { cspHeader, cspMode, extraOrigins, inlineHandlerHashes, inlineScriptHashes, securityHeaders } from './security-headers';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Security headers on every response. The content security policy starts in report-only mode (CSP_MODE=enforce turns blocking
 * on, off turns it off): violations are posted to the API, which logs them, so a policy that is too tight is found in the logs
 * and not by a reader with a blank map. CSP_EXTRA_ORIGINS lists the other hosts the map fetches from, such as the tile server
 * (outside production it defaults to the hosts the development map config uses).
 * The policy itself is added to each page as it is rendered, because the inline scripts Angular writes differ from page to page.
 */
const mode = cspMode(process.env['CSP_MODE']);
const cspBase = {
  extraOrigins: extraOrigins(process.env['CSP_EXTRA_ORIGINS'], process.env['NODE_ENV'] === 'production'),
  reportUri: '/api/csp-report',
};
app.disable('x-powered-by');
app.use((req, res, next) => {
  const secure = req.headers['x-forwarded-proto'] === 'https';
  for (const [name, value] of Object.entries(securityHeaders(secure))) {
    res.setHeader(name, value);
  }
  next();
});

/**
 * Liveness/readiness probe. Registered before the Angular handler because kubelet probes arrive with the pod IP
 * as the Host header, which Angular's SSRF host check (NG_ALLOWED_HOSTS) would reject.
 */
app.get('/healthz', (_req, res) => {
  res.type('text/plain').send('ok');
});

const apiInternalUrl = process.env['API_INTERNAL_URL'] ?? 'http://localhost:5186';

/**
 * The address readers use. PUBLIC_URL wins because behind the ingress the request's own host is an internal one;
 * without it (local development) the request's host is the best available.
 */
function publicOrigin(req: express.Request): string {
  return (process.env['PUBLIC_URL'] ?? `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

/**
 * The feed and sitemap are built by the API (which knows what is published) but must live at the site root, so the
 * server relays them. The forwarded headers make the API write links with the public address.
 */
for (const [route, contentType] of [
  ['/feed.xml', 'application/rss+xml; charset=utf-8'],
  ['/sitemap.xml', 'application/xml; charset=utf-8'],
] as const) {
  app.get(route, async (req, res, next) => {
    try {
      const origin = new URL(publicOrigin(req));
      const upstream = await fetch(`${apiInternalUrl}/api/content${route}`, {
        headers: { 'X-Forwarded-Host': origin.host, 'X-Forwarded-Proto': origin.protocol.replace(':', '') },
      });
      if (!upstream.ok) {
        res.status(502).type('text/plain').send('The feed is unavailable.');
        return;
      }
      res
        .status(200)
        .setHeader('Cache-Control', upstream.headers.get('cache-control') ?? 'public, max-age=60')
        .type(contentType)
        .send(await upstream.text());
    } catch (error) {
      next(error);
    }
  });
}

app.get('/robots.txt', (req, res) => {
  res
    .type('text/plain')
    .setHeader('Cache-Control', 'public, max-age=3600')
    .send(`User-agent: *
Disallow: /studio
Disallow: /api/

Sitemap: ${publicOrigin(req)}/sitemap.xml
`);
});

/**
 * Serve static files from /browser. Build output is content-hashed, so it can be cached for a year. Files under
 * /vendor are copied from node_modules with their original names, so they are revalidated (ETag) instead and an
 * upgrade of the library is picked up straight away.
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${sep}vendor${sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      }
    },
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then(async (response) => {
      if (!response) {
        return next();
      }
      if (response.headers.get('content-type')?.includes('text/html')) {
        const html = await response.clone().text();
        const header = cspHeader(mode, {
          ...cspBase,
          scriptHashes: inlineScriptHashes(html),
          handlerHashes: inlineHandlerHashes(html),
        });
        if (header) {
          res.setHeader(header[0], header[1]);
        }
      }
      return writeResponseToNodeResponse(response, res);
    })
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
