import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapViewStateService } from './map-view-state.service';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('MapViewStateService', () => {
  let service: MapViewStateService;
  let navigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideRouter([]), MapViewStateService] });
    service = TestBed.inject(MapViewStateService);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  it('writes the query string once the wait settles, merging it in and replacing rather than pushing a history entry', async () => {
    service.sync(() => ({ at: '1' }));
    expect(navigate).not.toHaveBeenCalled();

    await wait(450);

    expect(navigate).toHaveBeenCalledWith([], { queryParams: { at: '1' }, queryParamsHandling: 'merge', replaceUrl: true });
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
});
