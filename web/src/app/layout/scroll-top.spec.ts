import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ScrollTop } from './scroll-top';

async function render() {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(ScrollTop);
  await fixture.whenStable();
  return { fixture, button: (fixture.nativeElement as HTMLElement).querySelector('button')! };
}

describe('ScrollTop', () => {
  it('shows once the page is scrolled down more than a screen, and takes the reader back to the top', async () => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    const { fixture, button } = await render();
    expect(button.classList).not.toContain('is-shown');
    expect(button.getAttribute('tabindex')).toBe('-1');

    Object.defineProperty(window, 'scrollY', { value: window.innerHeight * 2, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    await fixture.whenStable();
    expect(button.classList).toContain('is-shown');
    expect(button.getAttribute('aria-label')).toBe('Scroll to top');

    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    button.click();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });
});
