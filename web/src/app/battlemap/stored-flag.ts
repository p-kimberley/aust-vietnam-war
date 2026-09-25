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
