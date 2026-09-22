import { Injectable, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { Params } from '@angular/router';

/** How long panning or a setting change must settle before the URL is written. */
const URL_SYNC_DELAY_MS = 400;

/**
 * Keeps the query string in step with the map, without adding a history entry for every pan or every filter change, and
 * without spamming the router while the map is still moving.
 *
 * `sync` takes a function that builds the query parameters rather than the parameters themselves, because what goes in the
 * URL (the camera, the selection, the filters…) can keep changing during the debounce; `build` is called only once the wait
 * has passed, so it always sees the state as it is then, not as it was when `sync` was called. Returning `null` (there is no
 * map yet to read the camera from) skips the navigation.
 *
 * Provided per map component, like `BasemapService`: one instance per map, so its timer is cleared when the map goes away.
 */
@Injectable()
export class MapViewStateService implements OnDestroy {
  private readonly router = inject(Router);
  private timer?: ReturnType<typeof setTimeout>;

  sync(build: () => Params | null): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const params = build();
      if (params) {
        void this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
      }
    }, URL_SYNC_DELAY_MS);
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
