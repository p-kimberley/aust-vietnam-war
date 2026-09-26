import { Injectable, computed, signal } from '@angular/core';
import { OperationFacts, TimelineUnit } from './timeline-data';

/** How far into the timeline the reader looks: the war's phases; their operations and months; or those, opened to their contacts. */
export type Zoom = 'strategic' | 'operational' | 'tactical';

export const ZOOMS: readonly { id: Zoom; label: string; hint: string }[] = [
  { id: 'strategic', label: 'Strategic', hint: 'The phases of the war' },
  { id: 'operational', label: 'Operational', hint: 'Each phase opened to its operations and months' },
  { id: 'tactical', label: 'Tactical', hint: 'Every operation and month opened to its contacts' },
];

/**
 * What the War Timeline shows: the zoom, the unit it is narrowed to, and which rows are open. The zoom decides what is open; the
 * reader may open or close any row besides, until the zoom changes again. One per page (provided by the page).
 */
@Injectable()
export class TimelineState {
  readonly zoom = signal<Zoom>('strategic');
  readonly unit = signal<TimelineUnit | null>(null);
  /** Every operation with a place on the timeline, for setting one against the rest. */
  readonly operations = signal<readonly OperationFacts[]>([]);
  /** The units with a history, by slug: for naming units, and narrowing to one. */
  readonly units = signal<ReadonlyMap<string, TimelineUnit>>(new Map());
  /** Rows the reader opened or closed against the zoom, by key (a phase's slug, `op:<slug>`, `month:<yyyy-MM>`). */
  private readonly overrides = signal<ReadonlyMap<string, boolean>>(new Map());

  /** Whether a phase is open to its operations and months. */
  phaseOpen(slug: string): boolean {
    return this.overrides().get(slug) ?? this.zoom() !== 'strategic';
  }

  /** Whether an operation or month is open to its narrative and contacts. */
  entryOpen(key: string): boolean {
    return this.overrides().get(key) ?? this.zoom() === 'tactical';
  }

  togglePhase(slug: string): void {
    this.set(slug, !this.phaseOpen(slug));
  }

  toggleEntry(key: string): void {
    this.set(key, !this.entryOpen(key));
  }

  /** Opens a row (and the phase it is in), as a link to it does. */
  open(phase: string, entry?: string): void {
    this.set(phase, true);
    if (entry) this.set(entry, true);
  }

  setZoom(zoom: Zoom): void {
    this.zoom.set(zoom);
    this.overrides.set(new Map());
  }

  /** Whether a row is to be shown for the unit chosen: where the unit took part, or always when none is chosen. */
  readonly shows = computed(() => {
    const unit = this.unit();
    return (units: readonly { slug: string }[]) => !unit || units.some((u) => u.slug === unit.slug);
  });

  private set(key: string, open: boolean): void {
    this.overrides.update((m) => new Map(m).set(key, open));
  }
}
