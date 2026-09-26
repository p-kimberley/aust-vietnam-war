import { Type, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { FeaturesPage } from './features-page';
import { HISTORIES, loadHistory } from './unit-histories/histories';
import { TABLE_ROWS_SHOWN, renderHistory, slug, splitFrontMatter } from './unit-histories/history-markdown';
import { UNITS, toursText } from './unit-histories/unit-facts';
import { UnitHistories } from './unit-histories/unit-histories';

function render<T>(component: Type<T>, inputs: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([])] });
  const fixture = TestBed.createComponent(component);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const SAMPLE = `---
unit: 5-rar
id: 1
title: 5th Battalion, Royal Australian Regiment
tours: April 1966 – May 1967
---

## Year by year

| Year | Contacts |
| --- | --: |
${Array.from({ length: 12 }, (_, i) => `| ${1960 + i} | ${i} |`).join('\n')}

## Sub-units

### B Company

[View B Company on the Battle Map](/battlemap?units=4)

## Roll of honour

- ![](/media/portraits/1.jpg) [A Name](/battlemap?person=1), Private, 24 May 1966

## Photographs

- [![A caption](/media/a-480.jpg)](/battlemap?picture=7) A caption

<script>alert(1)</script>

A [bad](javascript:alert(1)) link.
`;

describe('Unit Histories content', () => {
  it('has a history for every unit in the list, and nothing else', () => {
    expect(Object.keys(HISTORIES).sort()).toEqual(UNITS.map((u) => u.slug).sort());
    expect(UNITS).toHaveLength(16);
  });

  it("loads a unit's history, and nothing for a unit that has none", async () => {
    expect(splitFrontMatter((await loadHistory('5-rar'))!).head['short']).toBe('5 RAR');
    expect(await loadHistory('nope')).toBeNull();
    expect(await loadHistory('toString')).toBeNull();
  });

  it('gives every sub-unit in the list its heading in the history, under the same slug', async () => {
    for (const u of UNITS) {
      const ids = [...renderHistory((await loadHistory(u.slug))!).html.matchAll(/<h3 id="([^"]+)"/g)].map((m) => m[1]);
      for (const s of u.subUnits) expect(ids, `${u.slug}: ${s.slug}`).toContain(s.slug);
    }
  });

  it('puts tours in words', () => {
    expect(toursText([{ from: '1966-04', to: '1967-05' }, { from: '1969-02', to: '1970-02' }])).toBe('April 1966 – May 1967, February 1969 – February 1970');
  });
});

describe('renderHistory', () => {
  const r = renderHistory(SAMPLE, 'b-company');

  it('reads the head from the front matter, and lists the sections', () => {
    expect(r.head.title).toBe('5th Battalion, Royal Australian Regiment');
    expect(r.sections).toEqual([
      { id: 'year-by-year', label: 'Year by year' },
      { id: 'sub-units', label: 'Sub-units' },
      { id: 'roll-of-honour', label: 'Roll of honour' },
      { id: 'photographs', label: 'Photographs' },
    ]);
    expect(slug('1 ATF Artillery')).toBe('1-atf-artillery');
  });

  it('marks the sub-unit the address names', () => {
    expect(r.html).toContain('<h3 id="b-company" class="is-current">B Company <a class="anchor"');
  });

  it("gives each heading a link to itself: a sub-unit its own address, a section the page's", () => {
    expect(r.html).toContain('<a class="anchor" href="/features/unit-histories/5-rar#year-by-year" aria-label="Link to “Year by year”">#</a>');
    expect(r.html).toContain('<a class="anchor" href="/features/unit-histories/5-rar/b-company" aria-label="Link to “B Company”">#</a>');
    expect(r.sections[0]).toEqual({ id: 'year-by-year', label: 'Year by year' });
  });

  it('shows the first rows of a long table, with a button for the rest', () => {
    expect(r.html).toContain('<div class="table is-collapsed">');
    expect(r.html).toContain('Show all 12</button>');
    expect(TABLE_ROWS_SHOWN).toBe(10);
  });

  it('shows the roll of honour and the photographs as galleries, the photographs opening on the Battle Map', () => {
    expect(r.html).toContain('<ul class="gallery gallery--roll-of-honour">');
    expect(r.html).toContain('<ul class="gallery gallery--photographs">');
    expect(r.html).toContain('<a href="/battlemap?picture=7"><img src="/media/a-480.jpg" alt="A caption" loading="lazy"></a>');
  });

  it('shows any HTML as text, and drops links that are not addresses', () => {
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).not.toContain('javascript:');
  });
});

describe('UnitHistories', () => {
  it('introduces the histories, with a card and a list entry for each unit', () => {
    const el = render(UnitHistories);
    expect(el.querySelector('h1')?.textContent).toBe('Unit Histories');
    expect(el.querySelectorAll('.cards li')).toHaveLength(16);
    expect(el.querySelector('.list a[href="/features/unit-histories/sasr"]')?.textContent).toContain('SASR');
  });

  it("shows a unit's history, with its contents, and its sub-unit in the list and in the history marked", async () => {
    const history = await loadHistory('5-rar');
    const el = render(UnitHistories, { unit: '5-rar', sub: 'b-company', history });
    expect(el.querySelector('h1')?.textContent).toBe('5th Battalion, Royal Australian Regiment');
    expect(el.querySelector('#b-company')?.classList).toContain('is-current');
    expect(el.querySelector('.list a[aria-current=page]')?.textContent).toContain('B Company');
    expect(el.querySelector('a.btn')?.getAttribute('href')).toBe('/battlemap?units=1');
    const toc = [...el.querySelectorAll<HTMLAnchorElement>('app-unit-toc a')];
    expect(toc.map((a) => a.textContent)).toContain('Roll of honour');
    expect(toc.find((a) => a.textContent === 'Roll of honour')?.getAttribute('href')).toBe('/features/unit-histories/5-rar#roll-of-honour');
    for (const a of toc) expect(el.querySelector(a.getAttribute('href')!.slice(a.getAttribute('href')!.indexOf('#')))).not.toBeNull();
  });

  it("follows the history's own links without reloading, and shows a long table's other rows on request", async () => {
    const el = render(UnitHistories, { unit: '5-rar', history: await loadHistory('5-rar') });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    el.querySelector<HTMLAnchorElement>('.gallery--roll-of-honour a[href^="/battlemap?person="]')!.click();
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/battlemap\?person=/));

    const wrap = el.querySelector('.table.is-collapsed')!;
    wrap.querySelector<HTMLButtonElement>('button[data-more]')!.click();
    expect(wrap.classList).not.toContain('is-collapsed');
    expect(wrap.querySelector('button')?.textContent).toBe('Show fewer');
  });

  it('shows Not found for a unit, or a section, it has no history of', async () => {
    expect(render(UnitHistories, { unit: 'nope', history: null }).querySelector('h1')?.textContent).toBe('Page not found');
    TestBed.resetTestingModule();
    const history = await loadHistory('5-rar');
    expect(render(UnitHistories, { unit: '5-rar', sub: 'nope', history }).querySelector('h1')?.textContent).toBe('Page not found');
  });

  it('filters the list by name, sub-units included', () => {
    const el = render(UnitHistories);
    const input = el.querySelector<HTMLInputElement>('.filter input')!;
    input.value = 'squadron';
    input.dispatchEvent(new Event('input'));
    TestBed.tick();
    const names = [...el.querySelectorAll('.list > ul > li > a')].map((a) => a.firstChild?.textContent);
    expect(names).toEqual(['3 Cav Regt', '1 Armd Regt', 'SASR', '1 Fd Sqn']);
  });
});

describe('FeaturesPage', () => {
  it('leads to the Unit Histories', () => {
    const el = render(FeaturesPage);
    expect(el.querySelector('h2 a')?.getAttribute('href')).toBe('/features/unit-histories');
    expect(el.textContent).toContain('16 major Australian units');
  });
});
