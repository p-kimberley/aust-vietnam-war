import { ResolveFn } from '@angular/router';

// Kept apart from unit-facts.ts, which holds the list of units, so that the routes (in the site's first bundle) take only these
// loaders, and each history stays in a bundle of its own.

/**
 * Each unit's history (content/features/unit-histories/<unit>/history.md, written by `Avw.Features unit-histories render`), loaded
 * when its page is opened: one small bundle each. One line per unit in units.csv (the tests check the two agree).
 */
export const HISTORIES: Readonly<Record<string, () => Promise<{ default: string }>>> = {
  '1-rar': () => import('@content/features/unit-histories/1-rar/history.md', { with: { loader: 'text' } }),
  '2-rar': () => import('@content/features/unit-histories/2-rar/history.md', { with: { loader: 'text' } }),
  '3-rar': () => import('@content/features/unit-histories/3-rar/history.md', { with: { loader: 'text' } }),
  '4-rar': () => import('@content/features/unit-histories/4-rar/history.md', { with: { loader: 'text' } }),
  '5-rar': () => import('@content/features/unit-histories/5-rar/history.md', { with: { loader: 'text' } }),
  '6-rar': () => import('@content/features/unit-histories/6-rar/history.md', { with: { loader: 'text' } }),
  '7-rar': () => import('@content/features/unit-histories/7-rar/history.md', { with: { loader: 'text' } }),
  '8-rar': () => import('@content/features/unit-histories/8-rar/history.md', { with: { loader: 'text' } }),
  '9-rar': () => import('@content/features/unit-histories/9-rar/history.md', { with: { loader: 'text' } }),
  '3-cavalry-regiment': () => import('@content/features/unit-histories/3-cavalry-regiment/history.md', { with: { loader: 'text' } }),
  '1-armoured-regiment': () => import('@content/features/unit-histories/1-armoured-regiment/history.md', { with: { loader: 'text' } }),
  sasr: () => import('@content/features/unit-histories/sasr/history.md', { with: { loader: 'text' } }),
  '1-atf': () => import('@content/features/unit-histories/1-atf/history.md', { with: { loader: 'text' } }),
  '4-field-regiment': () => import('@content/features/unit-histories/4-field-regiment/history.md', { with: { loader: 'text' } }),
  '1-field-regiment': () => import('@content/features/unit-histories/1-field-regiment/history.md', { with: { loader: 'text' } }),
  '1-field-squadron': () => import('@content/features/unit-histories/1-field-squadron/history.md', { with: { loader: 'text' } }),
};

/** A unit's history.md, or null when there is no such unit (the page then shows Not found). */
export async function loadHistory(slug: string): Promise<string | null> {
  const load = Object.hasOwn(HISTORIES, slug) ? HISTORIES[slug] : undefined;
  return load ? (await load()).default : null;
}

/**
 * Loads the history before the page is made, on the server and in the browser alike, so the page the browser takes over from the
 * server's is the same one (it never shows "Loading" in between).
 */
export const historyResolver: ResolveFn<string | null> = (route) => loadHistory(route.paramMap.get('unit') ?? '');
