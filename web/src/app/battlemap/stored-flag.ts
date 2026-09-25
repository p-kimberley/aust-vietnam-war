import { WritableSignal, effect, signal } from '@angular/core';

/** Every flag kept in the browser starts with this, so they are easy to find and do not collide with anything else there. */
export const STORED_FLAG_PREFIX = 'avw.';

/** What the browser has kept for a flag, or `null` when it has nothing (or keeps nothing: storage can be off, full or absent). */
function read(key: string): boolean | null {
  try {
    const value = globalThis.localStorage?.getItem(STORED_FLAG_PREFIX + key);
    return value === 'true' ? true : value === 'false' ? false : null;
  } catch {
    return null;
  }
}

function write(key: string, value: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORED_FLAG_PREFIX + key, String(value));
  } catch {
    // Storage is off or full: the flag still works for this visit, it just is not remembered.
  }
}

/**
 * A yes-or-no setting the reader expects to find as they left it, such as whether a panel is shut: it starts as the browser last
 * kept it (or `initial`), and is kept again each time it changes. Kept per browser, not per link. Call it where `effect` may be
 * called (a field or a constructor of a component or service).
 */
export function storedFlag(key: string, initial: boolean): WritableSignal<boolean> {
  const flag = signal(read(key) ?? initial);
  effect(() => write(key, flag()));
  return flag;
}

/**
 * One of a few named choices the reader expects to find as they left it, such as which of two panels was showing: kept as a
 * {@link storedFlag} is, and anything kept that is not one of `choices` is ignored.
 */
export function storedChoice<T extends string>(key: string, choices: readonly T[], initial: T): WritableSignal<T> {
  let kept: string | null = null;
  try {
    kept = globalThis.localStorage?.getItem(STORED_FLAG_PREFIX + key) ?? null;
  } catch {
    // Storage is off: start at the default.
  }
  const choice = signal<T>(choices.includes(kept as T) ? (kept as T) : initial);
  effect(() => {
    const value = choice();
    try {
      globalThis.localStorage?.setItem(STORED_FLAG_PREFIX + key, value);
    } catch {
      // Storage is off or full: the choice still works for this visit, it just is not remembered.
    }
  });
  return choice;
}

/** The width below which the map is laid out for a phone (the `max-width` in battlemap.css), where panels would cover it. */
export const NARROW_SCREEN = '(max-width: 45rem)';

/** Whether the screen is phone-narrow; false where it cannot be told (jsdom has no matchMedia). */
export function narrowScreen(): boolean {
  return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(NARROW_SCREEN).matches;
}
