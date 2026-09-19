import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { API_BASE, apiInterceptor } from './api';
import { AuthService, Me } from './auth.service';
import { roleGuard } from './role.guard';

const editor: Me = { authenticated: true, id: 7, name: 'Pat', roles: ['editor'] };

function setup(platform: 'browser' | 'server' = 'browser', apiBase?: string) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(withInterceptors([apiInterceptor])),
      provideHttpClientTesting(),
      { provide: PLATFORM_ID, useValue: platform },
      ...(apiBase ? [{ provide: API_BASE, useValue: apiBase }] : []),
    ],
  });
  return { http: TestBed.inject(HttpClient), ctl: TestBed.inject(HttpTestingController) };
}

describe('apiInterceptor', () => {
  it('leaves GET requests alone in the browser', () => {
    const { http, ctl } = setup();
    http.get('/api/thing').subscribe();
    const req = ctl.expectOne('/api/thing');
    expect(req.request.headers.has('X-Requested-With')).toBe(false);
  });

  it('adds the CSRF header to state-changing requests', () => {
    const { http, ctl } = setup();
    http.post('/api/thing', {}).subscribe();
    expect(ctl.expectOne('/api/thing').request.headers.get('X-Requested-With')).toBe('avw');
  });

  it('points requests at the internal API during SSR', () => {
    const { http, ctl } = setup('server', 'http://avw-api:8080/api');
    http.get('/api/articles?x=1').subscribe();
    ctl.expectOne('http://avw-api:8080/api/articles?x=1');
  });

  it('does not touch non-API URLs', () => {
    const { http, ctl } = setup('browser', 'http://avw-api:8080/api');
    http.post('https://elsewhere.example/hook', {}).subscribe();
    const req = ctl.expectOne('https://elsewhere.example/hook');
    expect(req.request.headers.has('X-Requested-With')).toBe(false);
  });
});

describe('AuthService', () => {
  it('loads the user once and shares the request', async () => {
    const { ctl } = setup();
    const auth = TestBed.inject(AuthService);

    const a = auth.load();
    const b = auth.load();
    ctl.expectOne('/api/auth/me').flush(editor);

    expect(await a).toEqual(editor);
    expect(await b).toEqual(editor);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.loaded()).toBe(true);
    ctl.verify();
  });

  it('treats a failed lookup as signed out', async () => {
    const { ctl } = setup();
    const auth = TestBed.inject(AuthService);

    const p = auth.load();
    ctl.expectOne('/api/auth/me').flush('boom', { status: 500, statusText: 'Server Error' });

    expect((await p).authenticated).toBe(false);
    expect(auth.loaded()).toBe(true);
  });

  it('does not call the API on the server', async () => {
    const { ctl } = setup('server');
    const auth = TestBed.inject(AuthService);

    expect((await auth.load()).authenticated).toBe(false);
    ctl.expectNone('/api/auth/me');
  });

  it('ranks roles hierarchically', async () => {
    const { ctl } = setup();
    const auth = TestBed.inject(AuthService);
    const p = auth.load();
    ctl.expectOne('/api/auth/me').flush(editor);
    await p;

    expect(auth.hasRole('member')).toBe(true);
    expect(auth.hasRole('author')).toBe(true);
    expect(auth.hasRole('editor')).toBe(true);
    expect(auth.hasRole('admin')).toBe(false);
  });

  it('logs out through the API and follows the returned URL', async () => {
    const { ctl } = setup();
    const auth = TestBed.inject(AuthService);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...location, assign, pathname: '/', search: '' });

    const p = auth.logout();
    const req = ctl.expectOne('/api/auth/logout');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('X-Requested-With')).toBe('avw');
    req.flush({ redirectUrl: 'https://auth.example/logout' });
    await p;

    expect(assign).toHaveBeenCalledWith('https://auth.example/logout');
    expect(auth.isAuthenticated()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('roleGuard', () => {
  async function run(me: Me, role: 'author' | 'admin') {
    const { ctl } = setup();
    const auth = TestBed.inject(AuthService);
    const login = vi.spyOn(auth, 'login').mockImplementation(() => {});
    const result = TestBed.runInInjectionContext(() =>
      roleGuard(role)({} as never, { url: '/studio/articles' } as never),
    );
    ctl.expectOne('/api/auth/me').flush(me);
    return { result: await result, login, router: TestBed.inject(Router) };
  }

  it('lets a sufficiently privileged user through', async () => {
    expect((await run(editor, 'author')).result).toBe(true);
  });

  it('sends anonymous visitors to sign in and back to where they were going', async () => {
    const { result, login } = await run({ authenticated: false, id: null, name: null, roles: [] }, 'author');
    expect(result).toBe(false);
    expect(login).toHaveBeenCalledWith('/studio/articles');
  });

  it('sends signed-in users without the role to Forbidden', async () => {
    const { result, router } = await run(editor, 'admin');
    expect(router.serializeUrl(result as never)).toBe('/forbidden');
  });
});
