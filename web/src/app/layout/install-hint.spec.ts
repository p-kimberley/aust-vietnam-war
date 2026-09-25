import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NARROW_SCREEN, STORED_FLAG_PREFIX } from '../battlemap/stored-flag';
import { INSTALL_HINT_DELAY_MS, InstallHint } from './install-hint';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

async function mount(opts: { agent: string; narrow?: boolean; installed?: boolean; dismissed?: boolean }) {
  vi.useFakeTimers();
  localStorage.clear();
  if (opts.dismissed) localStorage.setItem(STORED_FLAG_PREFIX + 'installHint.dismissed', 'true');
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(opts.agent);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: (q === NARROW_SCREEN && (opts.narrow ?? true)) || (q === '(display-mode: standalone)' && !!opts.installed) }));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(InstallHint);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async (ms = 0) => {
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  };
  await settle();
  const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  return { el, settle, button, hint: () => el.querySelector('.hint') };
}

describe('the Home Screen hint', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tells an iPhone visitor, after a moment, how to add the site to the Home Screen, and not again once put away', async () => {
    const { settle, button, hint } = await mount({ agent: IPHONE });
    expect(hint()).toBeNull();

    await settle(INSTALL_HINT_DELAY_MS);
    expect(hint()?.textContent).toContain('Add to Home Screen');
    expect(button('Install')).toBeUndefined();

    button('Got it')!.click();
    await settle();
    expect(hint()).toBeNull();
    expect(localStorage.getItem(STORED_FLAG_PREFIX + 'installHint.dismissed')).toBe('true');
  });

  it('offers Chrome’s own install on Android, once Chrome says the site can be installed', async () => {
    const { settle, button, hint } = await mount({ agent: ANDROID });
    await settle(INSTALL_HINT_DELAY_MS);
    expect(hint()).toBeNull();

    const prompt = vi.fn(() => Promise.resolve());
    const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
    globalThis.dispatchEvent(offer);
    await settle();
    expect(offer.defaultPrevented).toBe(true);

    button('Install')!.click();
    await settle();
    expect(prompt).toHaveBeenCalled();
    expect(hint()).toBeNull();
  });

  it('is not shown once the site runs installed, on a wider screen, or after it was put away', async () => {
    for (const opts of [{ installed: true }, { narrow: false }, { dismissed: true }]) {
      const { settle, hint } = await mount({ agent: IPHONE, ...opts });
      await settle(INSTALL_HINT_DELAY_MS);
      expect(hint()).toBeNull();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
