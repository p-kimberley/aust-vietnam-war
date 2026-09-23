import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactFilteringService } from './contact-filtering.service';
import { FilterCatalogueService } from './filter-catalogue';
import { NO_FILTERS } from './filters';
import { CATALOGUE, CONTACTS } from './filter-fixtures';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function create(search: (text: string) => Promise<number[]> = () => Promise.resolve([])) {
  const filterService = { load: vi.fn(), search: vi.fn(search) };
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: FilterCatalogueService, useValue: filterService }, ContactFilteringService],
  });
  const service = TestBed.inject(ContactFilteringService);
  service.allContacts.set(CONTACTS);
  service.catalogue.set(CATALOGUE);
  return { service, filterService };
}

describe('ContactFilteringService', () => {
  it('shows every contact until the catalogue exists, since filtering needs it', () => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: FilterCatalogueService, useValue: { load: vi.fn(), search: vi.fn() } }, ContactFilteringService],
    });
    const service = TestBed.inject(ContactFilteringService);
    service.allContacts.set(CONTACTS);

    expect(service.visible()).toEqual(CONTACTS);
    expect(service.operationScope()).toEqual(CONTACTS);
  });

  it('leaves what the filters leave, once there is a catalogue to filter against', () => {
    const { service } = create();

    service.setFilters({ ...NO_FILTERS, series: new Set(['1ATF']) });

    expect(service.visible().map((c) => c.id)).toEqual([1, 2, 4]);
  });

  it('ignores the chosen operation and the dates when scoping the operation list, but keeps the rest of the filters', () => {
    const { service } = create();

    service.setFilters({ ...NO_FILTERS, series: new Set(['1ATF']), operations: new Set(['Coburg']), from: '1966-01-01', to: '1966-12-31' });

    expect(service.visible().map((c) => c.id)).toEqual([2]);                 // the operation and the dates both apply
    expect(service.operationScope().map((c) => c.id)).toEqual([1, 2, 4]);    // only the series does
  });

  it('counts how many contacts each unit has, and how many filters are active', () => {
    const { service } = create();

    expect(service.unitCounts().get(3233)).toBe(2);                          // 1 RAR: contacts 1 and 2, by their units' ancestors
    expect(service.activeCount()).toBe(0);

    service.setFilters({ ...NO_FILTERS, series: new Set(['1ATF']), mine: 'yes' });

    expect(service.activeCount()).toBe(2);
  });

  it('scopes operation, task, series and unit counts to every other active filter, dates and hours included', () => {
    const { service } = create();

    // Unfiltered: matches the catalogue's own (whole-dataset) counts.
    expect(service.operationCounts()).toEqual(new Map([['Coburg', 1], ['Hardihood, Phase 2', 2]]));
    expect(service.taskCounts()).toEqual(new Map([['Ambush', 1], ['Patrol', 2]]));
    expect(service.seriesCounts()).toEqual(new Map([['1ATF', 3], ['1RAR', 1]]));
    expect(service.unitCounts().get(15838)).toBe(1);

    // A date range leaving only the two 1966 contacts (1 and 4's "Hardihood, Phase 2" is in 1971, contact 3's "1RAR" in 1967).
    service.setFilters({ ...NO_FILTERS, from: '1966-01-01', to: '1966-12-31' });

    expect(service.operationCounts()).toEqual(new Map([['Coburg', 1], ['Hardihood, Phase 2', 1]]));
    expect(service.taskCounts()).toEqual(new Map([['Ambush', 1], ['Patrol', 1]]));
    expect(service.seriesCounts()).toEqual(new Map([['1ATF', 2]]));                    // 1RAR's only contact is outside the range
    expect(service.unitCounts().get(15838)).toBeUndefined();                           // that unit's only contact is outside the range too
  });

  it('does not zero out the facet a filter is already narrowing, so it can still be widened', () => {
    const { service } = create();

    service.setFilters({ ...NO_FILTERS, operations: new Set(['Coburg']) });

    // Choosing Coburg leaves only contact 2, but the operation count itself ignores that choice, still counting every contact
    // that passes the *other* filters (there are none here), so "Hardihood, Phase 2" stays choosable too.
    expect(service.operationCounts()).toEqual(new Map([['Coburg', 1], ['Hardihood, Phase 2', 2]]));
  });

  it('lists the ids the map shows, for the charts', () => {
    const { service } = create();

    expect(service.visibleIds()).toEqual(CONTACTS.map((c) => c.id));
  });

  it('says the text changed only when it did, from setFilters, toggleOperation and setDateRange alike', () => {
    const { service } = create();

    expect(service.setFilters({ ...NO_FILTERS, text: 'ambush' })).toBe(true);
    expect(service.setFilters({ ...service.filters(), series: new Set(['1ATF']) })).toBe(false);
    expect(service.toggleOperation('Coburg')).toBe(false);
    expect(service.setDateRange({ from: '1966-01-01', to: null })).toBe(false);
  });

  it('adds and removes an operation from the filters, any number at once', () => {
    const { service } = create();

    service.toggleOperation('Coburg');
    expect(service.filters().operations).toEqual(new Set(['Coburg']));

    service.toggleOperation('Hardihood, Phase 2');
    expect(service.filters().operations).toEqual(new Set(['Coburg', 'Hardihood, Phase 2']));

    service.toggleOperation('Coburg');
    expect(service.filters().operations).toEqual(new Set(['Hardihood, Phase 2']));
  });

  it('sets the date range the timeline chose', () => {
    const { service } = create();

    service.setDateRange({ from: '1966-03-01', to: '1966-04-01' });

    expect(service.filters()).toMatchObject({ from: '1966-03-01', to: '1966-04-01' });
  });

  describe('the report search', () => {
    it('does nothing for text shorter than the minimum, clearing any earlier result', () => {
      const { service, filterService } = create();
      service.setFilters({ ...NO_FILTERS, text: 'a' });

      expect(service.textStatus()).toBe('idle');
      expect(service.textIds()).toBeNull();
      expect(filterService.search).not.toHaveBeenCalled();
    });

    it('waits for typing to pause before asking the server, and only asks once for a pause', async () => {
      const { service, filterService } = create();

      service.setFilters({ ...NO_FILTERS, text: 'amb' });
      service.setFilters({ ...NO_FILTERS, text: 'ambu' });
      service.setFilters({ ...NO_FILTERS, text: 'ambush' });
      expect(service.textStatus()).toBe('searching');

      await wait(450);

      expect(filterService.search).toHaveBeenCalledTimes(1);
      expect(filterService.search).toHaveBeenCalledWith('ambush');
      expect(service.textStatus()).toBe('ready');
      expect(service.textIds()).toEqual(new Set());
    });

    it('reads the answer once it arrives, and tells onSearched', async () => {
      const { service } = create(() => Promise.resolve([1, 4]));
      const searched = vi.fn();
      service.onSearched = searched;

      service.setFilters({ ...NO_FILTERS, text: 'ambush' });
      await wait(450);

      expect(service.textIds()).toEqual(new Set([1, 4]));
      expect(searched).toHaveBeenCalledOnce();
    });

    it('drops the answer to a search superseded by a newer one, and does not call onSearched for it', async () => {
      let releaseFirst!: (ids: number[]) => void;
      const search = vi.fn((text: string) => (text === 'amb' ? new Promise<number[]>((r) => (releaseFirst = r)) : Promise.resolve([4])));
      const { service } = create(search);
      const searched = vi.fn();
      service.onSearched = searched;

      service.setFilters({ ...NO_FILTERS, text: 'amb' });
      await wait(450);
      service.setFilters({ ...NO_FILTERS, text: 'ambush' });
      await wait(450);
      releaseFirst([1, 2]);
      await wait(10);

      expect(service.textIds()).toEqual(new Set([4]));                      // the later search's answer, not the earlier one's
      expect(searched).toHaveBeenCalledOnce();
    });

    it('reports a search that fails, and calls onSearched even then', async () => {
      const { service } = create(() => Promise.reject(new Error('down')));
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const searched = vi.fn();
      service.onSearched = searched;

      service.setFilters({ ...NO_FILTERS, text: 'ambush' });
      await wait(450);

      expect(service.textStatus()).toBe('error');
      expect(service.textIds()).toBeNull();
      expect(searched).toHaveBeenCalledOnce();
    });

    it('searches at once, without waiting, when asked to', async () => {
      const { service, filterService } = create(() => Promise.resolve([2]));

      await service.searchNow('  ambush  ');

      expect(filterService.search).toHaveBeenCalledWith('ambush');
      expect(service.textIds()).toEqual(new Set([2]));
    });
  });
});
