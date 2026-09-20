import { PlatformLocation } from '@angular/common';
import { FetchBackend, HttpBackend, HttpEvent, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { Injectable, InjectionToken, Provider, inject } from '@angular/core';
import { Observable } from 'rxjs';

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

/** Adds the CSRF header to unsafe methods on API calls. */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/') || SAFE_METHODS.has(req.method)) {
    return next(req);
  }
  return next(req.clone({ setHeaders: { [CSRF_HEADER]: CSRF_VALUE } }));
};

/**
 * Sends `/api/...` requests to the internal API service instead (see `API_BASE`). This is done in the backend, at the
 * very end of the chain, rather than in an interceptor: the SSR transfer cache keys responses by the request URL it
 * sees, so it must still see the relative `/api/...` URL the browser will ask for, or the browser refetches everything
 * the server already loaded. Server config only.
 *
 * By the time a request reaches the backend, Angular's server has already made it absolute against the address of the
 * page being rendered (`http://<this server>/api/...`), so that form is matched too. Missing it would make the server
 * call itself.
 */
@Injectable()
export class ApiFetchBackend extends FetchBackend {
  private readonly base = inject(API_BASE);
  private readonly origin = pageOrigin(inject(PlatformLocation));

  override handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    return super.handle(rewriteApiUrl(req, this.base, this.origin));
  }
}

function pageOrigin(location: PlatformLocation): string {
  return `${location.protocol}//${location.hostname}${location.port ? `:${location.port}` : ''}`;
}

/** The request pointed at `base` in place of `/api`, or unchanged if it is not a request for this site's own API. */
export function rewriteApiUrl<T>(req: HttpRequest<T>, base: string, pageOrigin: string): HttpRequest<T> {
  const path = req.url.startsWith('/api/') ? req.url : req.url.startsWith(`${pageOrigin}/api/`) ? req.url.slice(pageOrigin.length) : null;
  return path && base !== '/api' ? req.clone({ url: base + path.slice('/api'.length) }) : req;
}

/** For the server config: routes API calls to the internal service address. */
export function provideApiRewrite(): Provider {
  return { provide: HttpBackend, useExisting: ApiFetchBackend };
}
