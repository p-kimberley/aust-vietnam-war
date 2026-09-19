import { HttpInterceptorFn } from '@angular/common/http';
import { InjectionToken, inject } from '@angular/core';

/**
 * Base URL for API calls. In the browser it is the relative `/api` (one host, path-based ingress, so no CORS).
 * During SSR there is no host to be relative to, so the server config points it at the API service instead.
 */
export const API_BASE = new InjectionToken<string>('API_BASE', {
  providedIn: 'root',
  factory: () => '/api',
});

/** Header the API requires on every state-changing request (see CsrfHeaderMiddleware). */
export const CSRF_HEADER = 'X-Requested-With';
export const CSRF_VALUE = 'avw';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/** Rewrites `/api/...` to the configured base and adds the CSRF header to unsafe methods. */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const base = inject(API_BASE);
  if (!req.url.startsWith('/api/')) {
    return next(req);
  }

  const url = base === '/api' ? req.url : base + req.url.slice('/api'.length);
  const setHeaders: Record<string, string> = SAFE_METHODS.has(req.method) ? {} : { [CSRF_HEADER]: CSRF_VALUE };
  return next(req.clone({ url, setHeaders }));
};
