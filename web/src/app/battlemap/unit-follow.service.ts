import { Injectable, computed, signal } from '@angular/core';
import { MAX_SEPARATE_TRACKS } from './track';

/**
 * Which units are followed: chosen with the button beside a unit's name in the incident panel, or carried over from a
 * `follow=` link. Drawing their paths needs the filtered contacts too, which is the map's business, not this service's, so
 * that stays in `Battlemap`; this only holds which units are chosen and enforces the limit on how many can be at once (more
 * would only tangle, since a battalion's companies work side by side in time).
 *
 * Provided per map component, like `BasemapService` and `MapSelectionService`.
 */
@Injectable()
export class UnitFollowService {
  readonly followed = signal<ReadonlySet<number>>(new Set());

  /** Paths of more units than this would only tangle, so no more can be followed. */
  readonly full = computed(() => this.followed().size >= MAX_SEPARATE_TRACKS);

  /** Follows a unit, or stops following it; adding beyond the limit does nothing. */
  toggle(unit: number): void {
    const next = new Set(this.followed());
    if (!next.delete(unit)) {
      if (next.size >= MAX_SEPARATE_TRACKS) {
        return;
      }
      next.add(unit);
    }
    this.followed.set(next);
  }

  /** Stops following everyone. */
  stop(): void {
    this.followed.set(new Set());
  }
}
