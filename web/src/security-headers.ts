import { createHash } from 'node:crypto';

/** How the content security policy is applied: `off`, watched without blocking (`report-only`), or `enforce`. */
export type CspMode = 'off' | 'report-only' | 'enforce';

export interface CspOptions {
  /** SHA-256 hashes (base64) of the inline scripts the server itself writes into the page. */
  scriptHashes: readonly string[];
  /** Hashes of the inline event handlers Angular writes (the one that switches its stylesheet on once loaded). */
  handlerHashes?: readonly string[];
  /** Other places the map may fetch styles, tiles, fonts and elevation from, such as the tile server. */
  extraOrigins: readonly string[];
  /** Where browsers send what was (or would have been) blocked. */
  reportUri?: string;
}

/** Reads the mode from the environment; anything unrecognised means the safe middle setting. */
export function cspMode(value: string | undefined): CspMode {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'off' || v === 'enforce' ? v : 'report-only';
}

/** Splits a space or comma separated list of origins, dropping anything that is not a plain http(s) origin. */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((o) => o.trim())
    .filter((o) => /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o));
}

/**
 * The hashes of every inline script in a rendered page. Angular writes two: the event dispatch contract that replays clicks made
 * before the page is interactive, and a line that starts it for the kinds of event this page uses. Their text depends on the
 * Angular version and on the page, so they are measured from each response and never written down. Data blocks such as the
 * transfer state are not scripts to the browser and need no hash.
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1];
    if (/\bsrc\s*=/i.test(attributes)) {
      continue;
    }
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]?.toLowerCase();
    if (type !== undefined && type !== 'text/javascript' && type !== 'module') {
      continue;
    }
    hashes.push(createHash('sha256').update(match[2]).digest('base64'));
  }
  return [...new Set(hashes)];
}

/** The hashes of inline `onload` handlers on stylesheet links, which is where Angular's inlined critical CSS switches the full stylesheet on. */
export function inlineHandlerHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<link\s[^>]*?\sonload="([^"]*)"/gi)) {
    hashes.push(createHash('sha256').update(match[1]).digest('base64'));
  }
  return [...new Set(hashes)];
}

/** The policy for the site's pages. Scripts run only from the site itself or by hash; nothing is framed or embedded except video. */
export function contentSecurityPolicy(o: CspOptions): string {
  const extra = o.extraOrigins.join(' ');
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...o.scriptHashes.map((h) => `'sha256-${h}'`)],
    // Inline handlers are refused unless they are exactly one of the handlers measured from the page.
    'script-src-attr': o.handlerHashes?.length ? ["'unsafe-hashes'", ...o.handlerHashes.map((h) => `'sha256-${h}'`)] : ["'none'"],
    // Angular writes its component styles inline.
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:', ...(extra ? [extra] : [])],
    // Pictures can come from an article or a map tile server, so any https origin, but never plain http.
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': ["'self'", ...(extra ? [extra] : [])],
    'worker-src': ["'self'", 'blob:'],
    'child-src': ["'self'", 'blob:'],
    'frame-src': ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  if (o.reportUri) {
    directives['report-uri'] = [o.reportUri];
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/** Headers for every response the web server sends. */
export function securityHeaders(secure: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  };
  if (secure) {
    headers['Strict-Transport-Security'] = 'max-age=31536000';
  }
  return headers;
}

/** The header that carries the policy for a page (blocking, or only watching), or null when it is off. */
export function cspHeader(mode: CspMode, csp: CspOptions): [name: string, value: string] | null {
  if (mode === 'off') {
    return null;
  }
  return [mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', contentSecurityPolicy(csp)];
}
