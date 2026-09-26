import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { describe, expect, it } from 'vitest';
import {
  MonthFacts,
  OperationFacts,
  PhaseFacts,
  TimelineContent,
  TimelineUnit,
  characterise,
  dayName,
  daySpan,
  layOut,
  monthName,
  paragraphs,
  withUnit,
} from './timeline-data';
import { WarTimeline } from './war-timeline';

const none = { frKia: 0, frWia: 0, enKia: 0, enWia: 0 };
const unit = (slug: string, short: string): TimelineUnit => ({
  slug, short, title: short, arm: 'infantry', unitId: 1, mapUnits: slug === '5-rar' ? '1' : '1419!,1483', contacts: 1, recorded: 1,
});
const phase = (slug: string, from: string, to: string, series: string | null, units = [{ slug: '5-rar', contacts: 3, led: 3 }]): PhaseFacts => ({
  slug, title: `Phase ${slug}`, from, to, unitSlugs: [], series, contacts: 3, recorded: 3, casualties: { ...none, frKia: 2 }, tasks: [],
  units, operations: [], mapUrl: `/battlemap?from=${from}&to=${to}`,
});
const month = (m: string, lead: string, contacts = 10): MonthFacts => ({
  month: m, contacts, casualties: none, tasks: [], units: [{ slug: lead, contacts, led: contacts }], operations: [], routine: 0, unassigned: 0,
  notable: [{ id: 7, date: `${m}-10`, unit: lead, unitLabel: 'A Coy', task: 'Patrol', operation: null, casualties: { ...none, enKia: 2 }, summary: `A patrol in ${m}.`, mapUrl: '/battlemap?incident=7' }],
  mapUrl: `/battlemap?from=${m}-01&to=${m}-28`,
});
const op = (slug: string, from: string, to: string, lead: string): OperationFacts => ({
  slug, name: slug[0].toUpperCase() + slug.slice(1), recorded: [slug], from, to, outside: 0, contacts: 20, casualties: none, tasks: [],
  units: [{ slug: lead, contacts: 20, led: 20 }], notable: [], mapUrl: `/battlemap?ops=${slug}`,
});

/** Two overlapping phases, as the first two are: 1 RAR's year with the Americans, and the Task Force's arrival. */
function content(): TimelineContent {
  return {
    facts: {
      from: '1965-05-29', to: '1966-08-17', contacts: 6157,
      phases: [phase('with-the-173rd', '1965-05-29', '1966-06-15', '1RAR', [{ slug: '1-rar', contacts: 3, led: 3 }]), phase('establishing', '1966-03-01', '1966-08-17', '1ATF')],
      months: [month('1965-05', '1-rar'), month('1966-03', '1-rar'), month('1966-05', '5-rar', 30)],
      operations: [op('silver-city', '1966-03-09', '1966-03-22', '1-rar'), op('hardihood', '1966-05-01', '1966-06-24', '5-rar')],
      units: [unit('1-rar', '1 RAR'), unit('5-rar', '5 RAR')],
      routine: [],
    },
    phases: { establishing: { summary: 'The Task Force arrives.', text: 'It arrived in April[1].\n\nIt built a base.', sources: [{ title: 'Nui Dat', publisher: 'Anzac Portal', url: 'https://anzacportal.dva.gov.au/x' }] } },
    operations: { hardihood: { summary: 'Clearing the villages.', text: 'The villages were cleared.', sources: [] } },
    months: {},
  };
}

describe('laying out the timeline', () => {
  it('puts each month and operation in its phase, in order, keeping 1 RAR\'s with the Americans where phases overlap', () => {
    const views = layOut(content());

    expect(views.map((v) => [v.phase.slug, v.entries.map((e) => e.key)])).toEqual([
      ['with-the-173rd', ['1965-05', '1966-03', 'silver-city']],           // May 1965 by its last day: the phase began on the 29th
      ['establishing', ['1966-05', 'hardihood']],
    ]);
    expect(views[1].narrative?.summary).toBe('The Task Force arrives.');
    expect(views[0].narrative).toBeNull();
  });

  it('splits a narrative into paragraphs of words and source marks', () => {
    expect(paragraphs('It arrived[1] and built[2].\n\nThen it waited.')).toEqual([
      [{ text: 'It arrived' }, { source: 1 }, { text: ' and built' }, { source: 2 }, { text: '.' }],
      [{ text: 'Then it waited.' }],
    ]);
  });

  it('writes dates and spans as a reader says them', () => {
    expect([monthName('1968-02'), monthName('1968-02', true), dayName('1968-02-09')]).toEqual(['February 1968', 'Feb 1968', '9 Feb 1968']);
    expect(daySpan('1966-05-01', '1966-05-20')).toBe('1–20 May 1966');
    expect(daySpan('1968-04-22', '1968-06-06')).toBe('22 Apr – 6 Jun 1968');
    expect(daySpan('1968-12-03', '1969-02-16')).toBe('3 Dec 1968 – 16 Feb 1969');
    expect(daySpan('1966-08-18', '1966-08-18')).toBe('18 Aug 1966');
  });

  it('narrows a Battle Map link to a unit with its exact filter, keeping the link\'s own', () => {
    expect(withUnit('/battlemap?ops=Coburg', unit('2-rar', '2 RAR'))).toBe('/battlemap?ops=Coburg&units=1419!%2C1483');
    expect(withUnit('/battlemap?ops=Coburg', null)).toBe('/battlemap?ops=Coburg');
  });
});

describe('characterising an operation', () => {
  const coburg: OperationFacts = {
    ...op('coburg', '1968-01-24', '1968-03-01', '2-rar'), contacts: 142, outside: 0,
    casualties: { frKia: 20, frWia: 123, enKia: 230, enWia: 74 },
    tasks: [{ task: 'Patrol', contacts: 52 }, { task: 'Security', contacts: 39 }, { task: 'Ambush', contacts: 31 }, { task: 'Transport', contacts: 5 }],
    units: [{ slug: '2-rar', contacts: 53, led: 52 }, { slug: '3-rar', contacts: 22, led: 20 }, { slug: '7-rar', contacts: 44, led: 43 }],
  };
  const quiet = (slug: string, frKia: number, enKia: number): OperationFacts => ({ ...op(slug, '1969-01-01', '1969-01-03', '5-rar'), casualties: { ...none, frKia, enKia } });
  const names = (slug: string) => slug.replace('-rar', ' RAR');

  it('says how long and busy it was, what the work was, who was most in contact, and what it cost against the rest', () => {
    const all = [coburg, quiet('a', 1, 2), quiet('b', 0, 0)];

    expect(characterise(coburg, all, names)).toBe(
      'A 38-day operation of 142 recorded contacts, about 26 a week. The work was mostly patrols (41%), security (31%) and ambushes (24%), ' +
        "with 2 RAR and 7 RAR most often in contact. It was the costliest operation of the war for the Task Force: 20 on the Task Force's side " +
        'and 230 enemy were recorded killed. Few operations recorded more enemy killed.',
    );
  });

  it("says so when no one on the Task Force's side was killed, and counts the contacts filed under its name outside its dates", () => {
    const light = { ...quiet('b', 0, 3), outside: 2, contacts: 1, tasks: [], units: [] };

    expect(characterise(light, [coburg, light], names)).toBe(
      "A 3-day operation of 1 recorded contact. No one on the Task Force's side was recorded killed; 3 enemy were recorded killed. " +
        'Few operations recorded more enemy killed. 2 more contacts are recorded under its name outside these dates.',
    );
  });
});

describe('WarTimeline', () => {
  async function render(query = '') {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: '**', component: WarTimeline, resolve: { content: () => content() } }], withComponentInputBinding()),
      ],
    });
    const { RouterTestingHarness } = await import('@angular/router/testing');
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl(`/features/war-timeline${query}`, WarTimeline);
    harness.detectChanges();
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const click = async (e: Element | null) => {
      (e as HTMLElement).click();
      harness.detectChanges();
      await harness.fixture.whenStable();
    };
    return { page, harness, el, text, click };
  }

  it('opens at the strategic level: the phases, with their figures and summaries, and none opened', async () => {
    const { el, text } = await render();

    expect([...el.querySelectorAll('app-timeline-phase h3')].map(text)).toEqual(['Phase with-the-173rd', 'Phase establishing']);
    expect(text(el.querySelector('app-timeline-phase .figures'))).toBe('3 contacts · 2 friendly killed, 0 wounded · 0 enemy recorded killed');
    expect(el.querySelectorAll('app-timeline-entry')).toHaveLength(0);
    expect(text(el.querySelector('.lead'))).toContain('6,157 recorded contacts');
  });

  it('zooms to operations and months, then to their contacts, and each row opens or closes on its own', async () => {
    const { el, text, click } = await render();
    const zoom = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.zoom button')].find((b) => text(b) === label)!;

    await click(zoom('Operational'));
    expect([...el.querySelectorAll('app-timeline-entry .title')].map(text)).toEqual(['May 1965', 'March 1966', 'Operation Silver-city', 'May 1966', 'Operation Hardihood']);
    expect(el.querySelector('app-timeline-entry app-contact-list')).toBeNull();
    expect(text(el.querySelector('#establishing app-narrative-text'))).toContain('It arrived in April');
    expect(el.querySelector<HTMLAnchorElement>('#establishing-src-1 a')!.href).toBe('https://anzacportal.dva.gov.au/x');

    await click(zoom('Tactical'));
    expect(el.querySelectorAll('app-timeline-entry app-contact-list')).toHaveLength(5);
    expect(text(el.querySelector('#m-1966-05 .summary'))).toBe('A patrol in 1966-05.');

    await click(el.querySelector('#m-1966-05 .head'));                         // one row closed against the zoom
    expect(el.querySelector('#m-1966-05 app-contact-list')).toBeNull();
    expect(el.querySelectorAll('app-timeline-entry app-contact-list')).toHaveLength(4);

    await click(el.querySelector('#with-the-173rd h3 button'));               // a phase closed
    expect(el.querySelectorAll('#with-the-173rd app-timeline-entry')).toHaveLength(0);
  });

  it('narrows the timeline to a unit, its Battle Map links with it, and keeps the view in the address', async () => {
    const { el, text, click, harness } = await render('?zoom=operational');
    const select = el.querySelector<HTMLSelectElement>('.unit select')!;

    select.value = '5-rar';
    select.dispatchEvent(new Event('change'));
    harness.detectChanges();
    await harness.fixture.whenStable();

    expect([...el.querySelectorAll('app-timeline-phase h3')].map(text)).toEqual(['Phase establishing']);
    expect([...el.querySelectorAll('app-timeline-entry .title')].map(text)).toEqual(['May 1966', 'Operation Hardihood']);
    expect(el.querySelector<HTMLAnchorElement>('#establishing .map a')!.getAttribute('href')).toBe('/battlemap?from=1966-03-01&to=1966-08-17&units=1');
    expect(TestBed.inject((await import('@angular/router')).Router).url).toContain('zoom=operational&unit=5-rar');

    await click(el.querySelector('#op-hardihood .head'));
    expect(el.querySelector<HTMLAnchorElement>('#op-hardihood .map')!.getAttribute('href')).toBe('/battlemap?ops=hardihood&units=1');
  });
});
