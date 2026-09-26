import { Location } from '@angular/common';
import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapViewStateService, changesMoreThanCamera } from './map-view-state.service';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('changesMoreThanCamera', () => {
  it('is false when only the camera moves, or nothing changes', () => {
    expect(changesMoreThanCamera({ at: '1', incident: '5' }, { at: '2', incident: '5' })).toBe(false);
    expect(changesMoreThanCamera({ at: '1' }, { at: '1', poi: null })).toBe(false);          // taking out what is not there
  });

  it('is true when something is opened, closed or changed, as the router would merge it', () => {
    expect(changesMoreThanCamera({ at: '1' }, { at: '1', incident: 5 })).toBe(true);
    expect(changesMoreThanCamera({ at: '1', incident: '5' }, { incident: null })).toBe(true);
    expect(changesMoreThanCamera({ basemap: 'dark' }, { basemap: 'terrain' })).toBe(true);
  });

  it('compares numbers and lists as the URL writes them', () => {
    expect(changesMoreThanCamera({ incident: '5', units: '3,4' }, { incident: 5, units: ['3', '4'] })).toBe(false);
  });
});

describe('MapViewStateService', () => {
  let service: MapViewStateService;
  let router: Router;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]), provideLocationMocks(), MapViewStateService] });
    service = TestBed.inject(MapViewStateService);
    router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  it('writes the query string once the wait settles, merging it in, and only updates the entry when just the camera moved', async () => {
    service.sync(() => ({ at: '1' }));
    expect(navigate).not.toHaveBeenCalled();

    await wait(450);

    expect(navigate).toHaveBeenCalledWith([], { queryParams: { at: '1' }, queryParamsHandling: 'merge', replaceUrl: true });
  });

  it('settles the entry the map opened on with its first write, rather than adding one (so Back leaves the map)', async () => {
    service.sync(() => ({ at: '1', roll: '1' }));

    await wait(450);

    expect(navigate).toHaveBeenCalledWith([], { queryParams: { at: '1', roll: '1' }, queryParamsHandling: 'merge', replaceUrl: true });
  });

  it('adds a history entry when what is open, the filters or the layers change', async () => {
    service.sync(() => ({ at: '1' }));
    await wait(450);
    service.sync(() => ({ at: '1', incident: 5 }));

    await wait(450);

    expect(navigate).toHaveBeenLastCalledWith([], { queryParams: { at: '1', incident: 5 }, queryParamsHandling: 'merge', replaceUrl: false });
  });

  it('adds no entry while told not to, as while the timeline plays', async () => {
    service.sync(() => ({ from: '1966-01-01' }), () => false);

    await wait(450);

    expect(navigate).toHaveBeenCalledWith([], { queryParams: { from: '1966-01-01' }, queryParamsHandling: 'merge', replaceUrl: true });
  });

  it('coalesces calls made before the wait settles into a single navigation', async () => {
    service.sync(() => ({ at: '1' }));
    await wait(200);
    service.sync(() => ({ at: '2' }));

    await wait(450);

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('builds the parameters from the live state at the moment the wait ends, not from when sync was called', async () => {
    let value = 'first';
    service.sync(() => ({ at: value }));
    value = 'second';

    await wait(450);

    expect(navigate).toHaveBeenCalledWith([], { queryParams: { at: 'second' }, queryParamsHandling: 'merge', replaceUrl: true });
  });

  it('writes nothing when build says there is nothing to write yet', async () => {
    service.sync(() => null);

    await wait(450);

    expect(navigate).not.toHaveBeenCalled();
  });

  it('drops a pending write once the service is destroyed', async () => {
    service.sync(() => ({ at: '1' }));

    service.ngOnDestroy();
    await wait(450);

    expect(navigate).not.toHaveBeenCalled();
  });

  describe('Back and Forward', () => {
    beforeEach(async () => {
      navigate.mockRestore();
      // The router listens for Back and Forward from its first navigation on, as it does once the app has started.
      router.initialNavigation();
      await wait(20);
    });

    async function goBackTo(url: string) {
      (TestBed.inject(Location) as SpyLocation).simulateUrlPop(url);
      await wait(20);
    }

    it('tells the map the parameters of the entry arrived at', async () => {
      const restored: unknown[] = [];
      service.onRestore = (params) => restored.push(params);

      await goBackTo('/?incident=5&at=10,107,9');

      expect(restored).toEqual([{ incident: '5', at: '10,107,9' }]);
    });

    it('drops what was waiting to be written for the entry being left', async () => {
      const spy = vi.spyOn(router, 'navigate');
      service.sync(() => ({ poi: 3 }));

      await goBackTo('/?incident=5');
      await wait(450);

      expect(spy).not.toHaveBeenCalled();
    });

    it('settles the entry arrived at rather than adding one, so Forward still goes forward', async () => {
      await goBackTo('/?incident=5&track=1');
      const spy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      service.sync(() => ({ incident: 5, track: null }));                     // the map writes it without the old parameter
      await wait(450);
      expect(spy).toHaveBeenLastCalledWith([], expect.objectContaining({ replaceUrl: true }));

      service.sync(() => ({ incident: 6 }));                                    // and after that, changes are entries again
      await wait(450);
      expect(spy).toHaveBeenLastCalledWith([], expect.objectContaining({ replaceUrl: false }));
    });
  });
});
