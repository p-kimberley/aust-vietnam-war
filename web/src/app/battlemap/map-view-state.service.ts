import { Injectable, OnDestroy, inject } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import type { Params } from '@angular/router';
import type { Subscription } from 'rxjs';

/** How long panning or a setting change must settle before the URL is written. */
const URL_SYNC_DELAY_MS = 400;

/** The query parameter that holds the camera: moving the map changes only this. */
const CAMERA_PARAM = 'at';

/** A parameter's value as the URL has it, so values written as strings, numbers or lists compare alike. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return Array.isArray(value) ? value.map(String).join(',') : String(value);
}

/**
 * Whether writing `next` over the query string `current` (merged, as the router merges it: a `null` takes a parameter out)
 * changes anything but the camera: what is open, the filters, the layers. Such a change is a new place in the browser's
 * history; moving the map is not.
 */
export function changesMoreThanCamera(current: Params, next: Params): boolean {
  const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
  keys.delete(CAMERA_PARAM);
  for (const key of keys) {
    const after = key in next ? asText(next[key]) : asText(current[key]);
    if (after !== asText(current[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Keeps the query string in step with the map, and the browser's Back and Forward buttons in step with the query string.
 *
 * Each settled change is written to the URL. One that changes what is open, the filters or the layers is a new entry in the
 * browser's history; one that only moves the map updates the entry it is on, so each entry remembers where the map was when
 * the reader moved on from it. `sync` takes a function that builds the query parameters rather than the parameters themselves,
 * because what goes in the URL can keep changing during the debounce; `build` is called only once the wait has passed.
 * Returning `null` (there is no map yet to read the camera from) skips the write. `mayAddEntry` can hold back new entries (Play
 * on the timeline changes the dates every few hundred milliseconds, and a history entry for each would bury the page's past).
 *
 * When the reader goes Back or Forward, whatever was waiting to be written is dropped and `onRestore` is told the parameters of
 * the entry arrived at, for the map to show it again; the first write after that settles that entry rather than adding one.
 *
 * Provided per map component, like `BasemapService`: one instance per map, so its timer is cleared when the map goes away.
 */
@Injectable()
export class MapViewStateService implements OnDestroy {
  private readonly router = inject(Router);
  private timer?: ReturnType<typeof setTimeout>;
  private readonly events: Subscription;
  /**
   * The reader has just gone Back or Forward. The next write only settles the entry arrived at (the map may write it a little
   * differently than it was, an old parameter dropped say); a new entry then would throw away everything Forward of it.
   */
  private arrived = false;

  /** Shows the map as a history entry has it. Set by the map once it can. */
  onRestore: ((params: Params) => void) | null = null;

  constructor() {
    let popped = false;
    this.events = this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        popped = e.navigationTrigger === 'popstate';
        if (popped) {
          // The state that was about to be written belongs to the entry being left, not the one arrived at.
          clearTimeout(this.timer);
          this.arrived = true;
        }
      } else if (e instanceof NavigationEnd && popped) {
        popped = false;
        this.onRestore?.(this.router.parseUrl(e.urlAfterRedirects).queryParams);
      }
    });
  }

  sync(build: () => Params | null, mayAddEntry: () => boolean = () => true): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const params = build();
      if (params) {
        const current = this.router.parseUrl(this.router.url).queryParams;
        const addEntry = !this.arrived && mayAddEntry() && changesMoreThanCamera(current, params);
        this.arrived = false;
        void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: !addEntry });
      }
    }, URL_SYNC_DELAY_MS);
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.events.unsubscribe();
  }
}
