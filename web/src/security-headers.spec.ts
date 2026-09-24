import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, cspHeader, cspMode, DEV_EXTRA_ORIGINS, extraOrigins, inlineHandlerHashes, inlineScriptHashes, parseOrigins, securityHeaders } from './security-headers';

const hashOf = (text: string) => createHash('sha256').update(text).digest('base64');

describe('cspMode', () => {
  it('watches by default and only blocks when asked', () => {
    expect(cspMode(undefined)).toBe('report-only');
    expect(cspMode('')).toBe('report-only');
    expect(cspMode('whatever')).toBe('report-only');
    expect(cspMode(' Enforce ')).toBe('enforce');
    expect(cspMode('OFF')).toBe('off');
  });
});

describe('parseOrigins', () => {
  it('keeps plain http(s) origins and drops anything that could widen the policy', () => {
    expect(parseOrigins('https://tiles.example.com, https://s3.amazonaws.com http://localhost:8080')).toEqual([
      'https://tiles.example.com',
      'https://s3.amazonaws.com',
      'http://localhost:8080',
    ]);
    expect(parseOrigins("https://a.example/path *; script-src 'unsafe-eval' data: https://ok.example")).toEqual(['https://ok.example']);
    expect(parseOrigins(undefined)).toEqual([]);
  });
});

describe('extraOrigins', () => {
  it('uses the configured list when there is one', () => {
    expect(extraOrigins('https://tiles.example.com', false)).toEqual(['https://tiles.example.com']);
    expect(extraOrigins('https://tiles.example.com', true)).toEqual(['https://tiles.example.com']);
  });

  it('falls back to the development map hosts, but never in production', () => {
    expect(extraOrigins(undefined, false)).toEqual([...DEV_EXTRA_ORIGINS]);
    expect(extraOrigins('  ', false)).toEqual([...DEV_EXTRA_ORIGINS]);
    expect(extraOrigins(undefined, true)).toEqual([]);
  });
});

describe('inlineScriptHashes', () => {
  it('hashes the exact text of each inline script and nothing else', () => {
    const contract = 'window.__contract = 1;';
    const html = `<html><head>
      <script type="text/javascript" id="ng-event-dispatch-contract">${contract}</script>
      <script src="main.js" type="module"></script>
      <script id="ng-state" type="application/json">{"a":1}</script>
      <script type="module">import('./x.js')</script>
      <script>${contract}</script>
    </head></html>`;

    expect(inlineScriptHashes(html)).toEqual([hashOf(contract), hashOf("import('./x.js')")]);
  });

  it('finds none in a page with only external scripts', () => {
    expect(inlineScriptHashes('<script src="a.js"></script>')).toEqual([]);
  });
});

describe('contentSecurityPolicy', () => {
  const policy = contentSecurityPolicy({ scriptHashes: ['abc='], extraOrigins: ['https://tiles.example.com'], reportUri: '/api/csp-report' });
  const directive = (name: string) => policy.split('; ').find((d) => d.startsWith(name + ' '));

  it('lets scripts run only from the site or by hash, never inline or eval', () => {
    expect(directive('script-src')).toBe("script-src 'self' 'sha256-abc='");
    expect(policy).not.toContain('unsafe-eval');
    expect(directive('script-src')).not.toContain('unsafe-inline');
  });

  it('allows the map to reach its tile host and workers, and video from two hosts only', () => {
    expect(directive('connect-src')).toBe("connect-src 'self' https://tiles.example.com");
    expect(directive('worker-src')).toBe("worker-src 'self' blob:");
    expect(directive('frame-src')).toBe('frame-src https://www.youtube-nocookie.com https://player.vimeo.com');
  });

  it('forbids plugins, framing, a changed base and reports where to send violations', () => {
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(directive('report-uri')).toBe('report-uri /api/csp-report');
  });

  it('serves fonts and styles from the site only: no font host is allowed', () => {
    expect(directive('font-src')).toBe("font-src 'self' data: https://tiles.example.com");
    expect(directive('style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain('googleapis');
    expect(policy).not.toContain('gstatic');
  });

  it('leaves the extra origins out when there are none', () => {
    const bare = contentSecurityPolicy({ scriptHashes: [], extraOrigins: [] });
    expect(bare).toContain("connect-src 'self';");
    expect(bare).not.toContain('report-uri');
  });
});

describe('inlineHandlerHashes', () => {
  it('hashes the onload handler Angular puts on its stylesheet link, and only that kind of handler', () => {
    const handler = "this.media='all'";
    const html = `<link rel="stylesheet" href="styles.css" media="print" onload="${handler}"><button onclick="steal()">x</button><link rel="icon" href="f.ico">`;

    expect(inlineHandlerHashes(html)).toEqual([hashOf(handler)]);
    expect(inlineHandlerHashes('<link rel="stylesheet" href="a.css">')).toEqual([]);
  });
});

describe('script-src-attr', () => {
  it('refuses every inline handler unless the page has the stylesheet one, which is then allowed by its hash alone', () => {
    const none = contentSecurityPolicy({ scriptHashes: [], extraOrigins: [] });
    expect(none).toContain("script-src-attr 'none'");

    const some = contentSecurityPolicy({ scriptHashes: [], handlerHashes: ['h1='], extraOrigins: [] });
    expect(some).toContain("script-src-attr 'unsafe-hashes' 'sha256-h1='");
    expect(some).not.toContain("script-src-attr 'none'");
  });
});

describe('securityHeaders', () => {
  it('always sends the basic protections, and no content security policy of its own', () => {
    const h = securityHeaders(false);
    expect(h).toMatchObject({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    expect(h['Permissions-Policy']).toContain('geolocation=()');
    expect(Object.keys(h).some((k) => k.startsWith('Content-Security-Policy'))).toBe(false);
  });

  it('insists on https only when the request arrived that way', () => {
    expect(securityHeaders(false)['Strict-Transport-Security']).toBeUndefined();
    expect(securityHeaders(true)['Strict-Transport-Security']).toBe('max-age=31536000');
  });
});

describe('cspHeader', () => {
  const csp = { scriptHashes: ['abc='], extraOrigins: [] };

  it('watches in report-only mode, blocks in enforce mode and sends nothing when off', () => {
    expect(cspHeader('report-only', csp)?.[0]).toBe('Content-Security-Policy-Report-Only');
    expect(cspHeader('enforce', csp)?.[0]).toBe('Content-Security-Policy');
    expect(cspHeader('off', csp)).toBeNull();
  });

  it('carries the same policy in either mode', () => {
    expect(cspHeader('enforce', csp)?.[1]).toBe(contentSecurityPolicy(csp));
    expect(cspHeader('report-only', csp)?.[1]).toBe(contentSecurityPolicy(csp));
  });
});
