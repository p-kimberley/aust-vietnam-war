import { Marked, Renderer, Tokens } from 'marked';

/** A table longer than this shows its first rows, and a button for the rest. */
export const TABLE_ROWS_SHOWN = 10;

/** The sections whose lists are shown as galleries: portraits, and photographs. */
const GALLERIES = new Set(['roll-of-honour', 'photographs']);

/** The head of a unit's history (history.md's front matter): what the page shows above it. */
export interface HistoryHead {
  unit: string;
  id: string;
  title: string;
  short: string;
  arm: string;
  tours: string;
  record: string;
  map: string;
  contacts: string;
  operations: string;
  dead: string;
  wounded: string;
  enemyKilled: string;
}

export interface RenderedHistory {
  head: HistoryHead;
  html: string;
  /** Its `##` sections, for the contents at the top. */
  sections: { id: string; label: string }[];
}

/** "B Company" → "b-company": a heading's id, the same as the fact sheet's slugs (so a sub-unit's address finds its heading). */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-');
}

/** Splits history.md into its front matter (simple `key: value` lines) and its Markdown. */
export function splitFrontMatter(text: string): { head: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { head: {}, body: text };
  const head: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) head[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { head, body: text.slice(m[0].length) };
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]);
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Only the site's own addresses, and the web's: nothing that could run script. */
const safeUrl = (href: string) => /^(\/(?!\/)|#|https:\/\/)/.test(href);

/**
 * Renders a unit's history.md. The Markdown is the repository's own (written by `Avw.Features unit-histories render` and
 * reviewed), and any HTML in it is shown as text, so the result is safe to put in the page as it is. Headings get their slugs as
 * ids; the sub-unit heading `current` names is marked; the roll of honour and the photographs are galleries; and a long table
 * shows its first rows, with a button for the rest.
 */
export function renderHistory(text: string, current: string | null = null): RenderedHistory {
  const { head, body } = splitFrontMatter(text);
  const sections: { id: string; label: string }[] = [];
  let section = '';

  const base = new Renderer();
  const renderer = new Renderer();
  renderer.heading = function (this: Renderer, token: Tokens.Heading) {
    const inner = this.parser.parseInline(token.tokens);
    const id = slug(plain(inner));
    if (token.depth === 2) {
      section = id;
      sections.push({ id, label: plain(inner) });
    }
    const mark = token.depth === 3 && id === current ? ' class="is-current"' : '';
    // A link to the heading itself, to copy or share: a sub-unit's own address, or the page's with the section.
    const page = `/features/unit-histories/${escapeHtml(head['unit'] ?? '')}`;
    const href = token.depth === 3 && section === 'sub-units' ? `${page}/${id}` : `${page}#${id}`;
    const label = escapeHtml(`Link to “${plain(inner)}”`);
    const anchor = token.depth <= 3 ? ` <a class="anchor" href="${href}" aria-label="${label}">#</a>` : '';
    return `<h${token.depth} id="${id}"${mark}>${inner}${anchor}</h${token.depth}>\n`;
  };
  renderer.html = (token: Tokens.HTML | Tokens.Tag) => escapeHtml(token.text);
  renderer.link = function (this: Renderer, token: Tokens.Link) {
    const inner = this.parser.parseInline(token.tokens);
    return safeUrl(token.href) ? `<a href="${escapeHtml(token.href)}">${inner}</a>` : inner;
  };
  renderer.image = (token: Tokens.Image) =>
    safeUrl(token.href) ? `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(token.text)}" loading="lazy">` : '';
  renderer.list = function (this: Renderer, token: Tokens.List) {
    const html = base.list.call(this, token);
    return GALLERIES.has(section) ? html.replace(/^<ul>/, `<ul class="gallery gallery--${section}">`) : html;
  };
  renderer.table = function (this: Renderer, token: Tokens.Table) {
    const html = base.table.call(this, token);
    if (token.rows.length <= TABLE_ROWS_SHOWN) return `<div class="table">${html}</div>`;
    return (
      `<div class="table is-collapsed">${html}` +
      `<button type="button" class="show-more" data-more>Show all ${token.rows.length}</button></div>\n`
    );
  };

  const html = new Marked({ renderer, gfm: true, async: false }).parse(body) as string;
  return { head: head as unknown as HistoryHead, html, sections };
}
