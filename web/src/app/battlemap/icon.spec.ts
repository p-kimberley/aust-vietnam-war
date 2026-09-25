import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Icon } from './icon';

describe('Icon', () => {
  function icon(name: string, filled = false) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(Icon);
    fixture.componentRef.setInput('name', name);
    fixture.componentRef.setInput('filled', filled);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws the named shape in outline, in the colour of the words, hidden from screen readers', () => {
    const el = icon('pin');

    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('path')?.getAttribute('d')).toMatch(/^M20 10c0 6/);
    expect(el.querySelector('svg')?.getAttribute('fill')).toBe('none');
    expect(el.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
  });

  it('fills a shape when asked, as a liked heart is, and always for play and pause', () => {
    expect(icon('heart', true).querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
    expect(icon('play').querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  });
});
