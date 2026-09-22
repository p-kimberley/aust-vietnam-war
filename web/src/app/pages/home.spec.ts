import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { Home } from './home';

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(Home);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const ctl = TestBed.inject(HttpTestingController);
  ctl.match(() => true).forEach((req) => req.flush({ items: [], total: 0, page: 1, pageSize: req.request.params.get('pageSize') }));
  const link = (text: string) => [...el.querySelectorAll('a')].find((a) => a.textContent?.trim() === text)!;
  return { fixture, el, link };
}

describe('Home', () => {
  it('sends the honour roll link straight to the fly-out, not just the plain map', () => {
    const { link } = setup();

    expect(link('See the honour roll').getAttribute('href')).toBe('/battlemap?roll=1');
  });

  it('leaves the other Battle Map links at the plain map', () => {
    const { link } = setup();

    expect(link('Open the Battle Map').getAttribute('href')).toBe('/battlemap');
    expect(link('Explore the map').getAttribute('href')).toBe('/battlemap');
  });
});
