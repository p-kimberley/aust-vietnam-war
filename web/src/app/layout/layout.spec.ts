import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RESPONSE_INIT, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { AuthService, Me } from '../core/auth.service';
import { NotFound } from '../pages/not-found';
import { SiteHeader } from './site-header';

function render(me: Me | 'pending') {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const ctl = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(SiteHeader);
  const loading = TestBed.inject(AuthService).load();
  if (me !== 'pending') {
    ctl.expectOne('/api/auth/me').flush(me);
  }
  return { fixture, loading, ctl };
}

/** Answers the navigation request the header makes for authored pages (none, unless a test says otherwise). */
function answerNav(f: ReturnType<typeof render>, pages: object[] = []) {
  f.ctl.match('/api/content/pages').forEach((r) => r.flush(pages));
}

async function text(f: ReturnType<typeof render>, pages: object[] = []) {
  await f.loading.catch(() => undefined);
  f.fixture.detectChanges();
  answerNav(f, pages);
  await f.fixture.whenStable();
  return (f.fixture.nativeElement as HTMLElement).textContent ?? '';
}

describe('SiteHeader', () => {
  it('shows neither sign in nor the user until the session lookup finishes', async () => {
    const r = render('pending');
    r.fixture.detectChanges();
    const t = (r.fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(t).not.toContain('Sign in');
    expect(t).not.toContain('Sign out');
  });

  it('offers sign in and register to visitors', async () => {
    const t = await text(render({ authenticated: false, id: null, name: null, roles: [] }));
    expect(t).toContain('Sign in');
    expect(t).toContain('Register');
    expect(t).not.toContain('Studio');
  });

  it('shows the name and hides Studio from plain members', async () => {
    const t = await text(render({ authenticated: true, id: 1, name: 'Pat Member', roles: ['member'] }));
    expect(t).toContain('Pat Member');
    expect(t).toContain('Sign out');
    expect(t).not.toContain('Studio');
  });

  it('lists the published pages in the navigation, after Stories', async () => {
    const r = render({ authenticated: false, id: null, name: null, roles: [] });
    const t = await text(r, [
      { title: 'About', path: 'about', children: [] },
      { title: 'Help', path: 'help', children: [] },
    ]);
    const links = [...(r.fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('nav[aria-label=Main] a')];
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Home', '/'],
      ['Battle Map', '/battlemap'],
      ['Features', '/features'],
      ['Stories', '/articles'],
      ['About', '/about'],
      ['Help', '/help'],
    ]);
    expect(t).toContain('Sign in');
  });

  it('links to Studio for authors and above', async () => {
    const t = await text(render({ authenticated: true, id: 2, name: 'Pat Author', roles: ['author'] }));
    expect(t).toContain('Studio');
  });
});

describe('NotFound', () => {
  it('sets a 404 response status during SSR', () => {
    const init: ResponseInit = {};
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: RESPONSE_INIT, useValue: init }],
    });
    TestBed.createComponent(NotFound);
    expect(init.status).toBe(404);
  });

  it('still renders in the browser, where there is no response', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([])] });
    const fixture = TestBed.createComponent(NotFound);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Page not found');
  });
});
