import { ResolveFn } from '@angular/router';

// The War Timeline's content (content/features/war-timeline/: facts.json from `Avw.Features war-timeline facts`, and the
// narratives in narratives/, written to STYLE.md there), and how the page lays it out. See docs/war-timeline-plan.md.

export interface Casualties {
  frKia: number;
  frWia: number;
  enKia: number;
  enWia: number;
}

export interface TaskCount {
  task: string;
  contacts: number;
}

export interface UnitCount {
  slug: string;
  contacts: number;
  /** How many of them the unit (or one of its own) was the unit in contact. */
  led: number;
}

export interface OperationCount {
  name: string;
  /** The operation's slug where it has a place of its own on the timeline. */
  slug: string | null;
  contacts: number;
}

export interface TimelineContact {
  id: number;
  date: string;
  /** The history unit in contact (its slug), or null. */
  unit: string | null;
  unitLabel: string;
  task: string | null;
  operation: string | null;
  casualties: Casualties;
  summary: string | null;
  mapUrl: string;
}

export interface PhaseFacts {
  slug: string;
  title: string;
  from: string;
  to: string;
  unitSlugs: string[];
  series: string | null;
  contacts: number;
  recorded: number;
  casualties: Casualties;
  tasks: TaskCount[];
  units: UnitCount[];
  operations: OperationCount[];
  mapUrl: string;
}

export interface MonthFacts {
  /** `yyyy-MM`. */
  month: string;
  contacts: number;
  casualties: Casualties;
  tasks: TaskCount[];
  units: UnitCount[];
  operations: OperationCount[];
  routine: number;
  unassigned: number;
  notable: TimelineContact[];
  mapUrl: string;
}

export interface OperationFacts {
  slug: string;
  name: string;
  recorded: string[];
  from: string;
  to: string;
  outside: number;
  contacts: number;
  casualties: Casualties;
  tasks: TaskCount[];
  units: UnitCount[];
  notable: TimelineContact[];
  mapUrl: string;
}

export interface TimelineUnit {
  slug: string;
  short: string;
  title: string;
  arm: string;
  unitId: number;
  /** The Battle Map's unit filter for exactly the unit's units. */
  mapUnits: string;
  contacts: number;
  recorded: number;
}

export interface TimelineFacts {
  from: string;
  to: string;
  contacts: number;
  phases: PhaseFacts[];
  months: MonthFacts[];
  operations: OperationFacts[];
  units: TimelineUnit[];
  routine: string[];
}

export interface Source {
  title: string;
  publisher: string;
  url: string;
}

/** A phase's, operation's or month's narrative (see STYLE.md): a one-line summary, paragraphs, and the sources `[n]` cites. */
export interface Narrative {
  summary: string;
  text: string;
  sources: Source[];
}

export interface TimelineContent {
  facts: TimelineFacts;
  phases: Record<string, Narrative>;
  operations: Record<string, Narrative>;
  months: Record<string, Narrative>;
}

/** Loads the facts and narratives: a bundle of their own, fetched only for this page. */
export async function loadTimeline(): Promise<TimelineContent> {
  const [facts, phases, operations, months] = await Promise.all([
    import('@content/features/war-timeline/facts.json'),
    import('@content/features/war-timeline/narratives/phases.json'),
    import('@content/features/war-timeline/narratives/operations.json'),
    import('@content/features/war-timeline/narratives/months.json'),
  ]);
  return {
    facts: facts.default as unknown as TimelineFacts,
    phases: phases.default as unknown as Record<string, Narrative>,
    operations: operations.default as unknown as Record<string, Narrative>,
    months: months.default as unknown as Record<string, Narrative>,
  };
}

/** Loads the content before the page is made, on the server and in the browser alike, so the two pages are the same. */
export const timelineResolver: ResolveFn<TimelineContent> = () => loadTimeline();

// ---------------------------------------------------------------- the layout

/** A row under a phase: a month of the Task Force's work, or an operation (placed after the month it began in). */
export type TimelineEntry =
  | { kind: 'month'; key: string; sort: string; month: MonthFacts; narrative: Narrative | null }
  | { kind: 'operation'; key: string; sort: string; operation: OperationFacts; narrative: Narrative | null };

export interface PhaseView {
  phase: PhaseFacts;
  narrative: Narrative | null;
  entries: TimelineEntry[];
}

/**
 * The phases, each with its months and operations in order. A month or an operation goes to the latest phase whose dates hold its
 * start (phases may overlap: 1 RAR's last months with the Americans ran on after the Task Force arrived), except that one led by a
 * unit a phase is about, or in a phase's own data series, stays in that phase.
 */
export function layOut(content: TimelineContent): PhaseView[] {
  const { facts } = content;
  const views = facts.phases.map((phase) => ({ phase, narrative: content.phases[phase.slug] ?? null, entries: [] as TimelineEntry[] }));
  const holding = (day: string) => views.filter((v) => v.phase.from <= day && day <= v.phase.to);
  const place = (day: string, lead: string | undefined) => {
    const candidates = holding(day);
    return (
      candidates.find((v) => lead !== undefined && (v.phase.unitSlugs.includes(lead) || (v.phase.series === '1RAR' && lead === '1-rar'))) ??
      candidates.at(-1)
    );
  };

  for (const month of facts.months) {
    const lead = month.units[0]?.slug;
    // A month belongs to the phase it mostly is: judged at its middle, and by the unit most in contact; or, where no phase has
    // begun by its middle (the first), by its last day.
    const last = `${month.month}-${new Date(Date.UTC(Number(month.month.slice(0, 4)), Number(month.month.slice(5, 7)), 0)).getUTCDate()}`;
    (place(`${month.month}-15`, lead) ?? place(last, lead))?.entries.push({
      kind: 'month', key: month.month, sort: `${month.month}-00`, month, narrative: content.months[month.month] ?? null,
    });
  }
  for (const operation of facts.operations) {
    place(operation.from, operation.units[0]?.slug)?.entries.push({
      kind: 'operation', key: operation.slug, sort: `${operation.from.slice(0, 7)}-${operation.from.slice(8)}`, operation,
      narrative: content.operations[operation.slug] ?? null,
    });
  }
  for (const v of views) v.entries.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  return views;
}

/** The parts of a narrative's text: paragraphs of words and source markers (`[2]` is the second source). */
export function paragraphs(text: string): Array<Array<{ text: string } | { source: number }>> {
  return text
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => p.split(/(\[\d+\])/).filter(Boolean).map((part) => (/^\[\d+\]$/.test(part) ? { source: Number(part.slice(1, -1)) } : { text: part })));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

/** `1968-02` as "February 1968", or, `short`, "Feb 1968". */
export function monthName(month: string, short = false): string {
  return `${(short ? SHORT : MONTHS)[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** `1968-02-09` as "9 Feb 1968"; with `year` false, "9 Feb". */
export function dayName(day: string, year = true): string {
  const text = `${Number(day.slice(8, 10))} ${SHORT[Number(day.slice(5, 7)) - 1]}`;
  return year ? `${text} ${day.slice(0, 4)}` : text;
}

/** Two days as a span: "1–20 May 1966", "28 Apr – 3 Jun 1966", "3 Dec 1968 – 19 Feb 1969". */
export function daySpan(from: string, to: string): string {
  if (from === to) return dayName(from);
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${dayName(from)} – ${dayName(to)}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8, 10))}–${dayName(to)}`;
  return `${dayName(from, false)} – ${dayName(to)}`;
}

/** A Battle Map link narrowed to a unit too, where one is chosen (its exact filter), keeping the link's own filters. */
export function withUnit(url: string, unit: TimelineUnit | null): string {
  if (!unit) return url;
  return `${url}${url.includes('?') ? '&' : '?'}units=${encodeURIComponent(unit.mapUnits)}`;
}

// ---------------------------------------------------------------- an operation, characterised

/** A task as a kind of work, for "mostly patrols and ambushes". */
function workOf(task: string): string {
  const words: Record<string, string> = {
    Patrol: 'patrols', Ambush: 'ambushes', Security: 'security', Bunker: 'bunker fighting', 'Artillery and mortar fire': 'artillery and mortar fire',
    Installation: 'guarding installations', Transport: 'escorting transport', Deployment: 'deploying', Sighting: 'sightings',
    'Harassing fire': 'harassing fire', 'Mine or booby trap': 'mines and booby traps', Assault: 'assaults', Attack: 'attacks',
  };
  return words[task] ?? task.toLowerCase();
}

const ORDINALS = ['', '', 'second', 'third', 'fourth', 'fifth'];

/**
 * What kind of operation it was, from its figures alone, set against the other operations': how long and how busy, what the work
 * was, who was most in contact, and what it cost. `name` gives a unit's short name.
 */
export function characterise(op: OperationFacts, all: readonly OperationFacts[], name: (slug: string) => string): string {
  const days = Math.round((Date.parse(op.to) - Date.parse(op.from)) / 86_400_000) + 1;
  const length = days === 1 ? 'A one-day operation' : `A ${days}-day operation`;
  const pace = days >= 14 ? `, about ${Math.round((op.contacts / days) * 7)} a week` : '';
  const sentences = [`${length} of ${op.contacts} recorded contact${op.contacts === 1 ? '' : 's'}${pace}.`];

  const recorded = op.tasks.reduce((n, t) => n + t.contacts, 0);
  const work = op.tasks.filter((t) => t.contacts / Math.max(1, recorded) >= 0.15).slice(0, 3).map((t) => `${workOf(t.task)} (${Math.round((100 * t.contacts) / recorded)}%)`);
  const leads = op.units.filter((u) => u.led > 0).sort((a, b) => b.led - a.led).slice(0, 2).map((u) => name(u.slug));
  const parts = [
    work.length ? `The work was mostly ${list(work)}` : '',
    leads.length ? `${work.length ? ', with' : 'Its contacts were mostly'} ${list(leads)} most often in contact` : '',
  ].join('');
  if (parts) sentences.push(`${parts}.`);

  const { frKia, enKia } = op.casualties;
  const rank = all.filter((o) => o.casualties.frKia > frKia).length + 1;
  const enemyRank = all.filter((o) => o.casualties.enKia > enKia).length + 1;
  if (frKia === 0) sentences.push(`No one on the Task Force's side was recorded killed${enKia ? `; ${enKia} enemy were recorded killed` : ''}.`);
  else {
    const costly = rank === 1 ? 'the costliest operation of the war for the Task Force' : rank <= 5 ? `the ${ORDINALS[rank]} costliest operation of the war for the Task Force` : rank <= Math.ceil(all.length / 5) ? 'one of the costlier operations of the war for the Task Force' : '';
    const killed = `${frKia} on the Task Force's side and ${enKia} enemy were recorded killed`;
    sentences.push(costly ? `It was ${costly}: ${killed}.` : `${killed[0].toUpperCase()}${killed.slice(1)}.`);
  }
  if (enemyRank <= 5 && enKia > 0) sentences.push(`Few operations recorded more enemy killed.`);
  if (op.outside) sentences.push(`${op.outside} more contact${op.outside === 1 ? ' is' : 's are'} recorded under its name outside these dates.`);
  return sentences.join(' ');
}

function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
