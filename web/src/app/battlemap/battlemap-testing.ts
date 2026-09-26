import { PicturePlacementService } from './picture-placement.service';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AnalyticsPanel } from './analytics/analytics-panel';
import { AnalyticsService, ChartInfo, ChartResult } from './analytics/analytics';
import { stubEchartIn } from './analytics/echart-stub';
import { communityProviders, fakeAuth, fakeCommunity } from './community/community-testing';
import { Timeline } from './analytics/timeline';
import { BasemapService, MapHooks } from './basemap.service';
import { Battlemap } from './battlemap';
import { MapSelectionService } from './map-selection.service';
import { MapViewStateService } from './map-view-state.service';
import { ContactFilteringService } from './contact-filtering.service';
import { UnitFollowService } from './unit-follow.service';
import { Contact, ContactDetail } from './contacts';
import { ContactsService } from './contacts.service';
import { CATALOGUE } from './filter-fixtures';
import { FilterCatalogue, FilterCatalogueService } from './filter-catalogue';
import { MapConfig, MapConfigService } from './map-config';
import { Poi, PoiDetail, PoiService } from './poi';

/** Fixtures and a harness shared by the Battle Map specs. The map itself is replaced by a recording stand-in. */

export const contacts: Contact[] = [
  { id: 2, dtg: '1966-03-03T19:50:00', lat: 10.55, lon: 107.16, fr: 25, frCas: 0, en: 5, enCas: 0, frKia: 0, frWia: 0, enKia: 0, enWia: 0, units: [3], op: 0, task: 0, series: 1, mine: 0 },
  { id: 9, dtg: '1966-03-05T08:10:00', lat: 10.61, lon: 107.2, fr: 40, frCas: 2, en: 12, enCas: 7, frKia: 1, frWia: 1, enKia: 5, enWia: 2, units: [3, 4], op: 0, task: 0, series: 1, mine: 0 },
  { id: 11, dtg: '1966-04-01T00:00:00', lat: 10.7, lon: 107.3, fr: 10, frCas: 1, en: 0, enCas: 3, frKia: 0, frWia: 1, enKia: 3, enWia: 0, units: [], op: 0, task: 0, series: 1, mine: 0 },
];

export const detail: ContactDetail = {
  id: 2, dtg: '1966-03-03T19:50:00', lat: 10.55, lon: 107.16, gridRef: 'YS374671', operation: 'Hardihood', unitTask: null,
  units: [{ id: 3, shortName: '1 Pl, A Coy', longName: '1 Platoon, A Company' }],
  frForce: 25, enForce: 5, frKia: 1, frWia: 2, enKia: 3, enWia: 4,
  description: 'AT LOC STATED.', archivalSource: 'Intel V-dat Base', sourceUrl: null,
};

export const POIS: Poi[] = [
  { id: 1, type: 'FSB', name: 'Le Loi', established: 1970, lat: 10.63, lon: 107.24 },
  { id: 2, type: 'LZ', name: 'Hawk', established: null, lat: 10.5, lon: 107.1 },
];

export const poiDetail: PoiDetail = { ...POIS[0], details: 'On Route 2, north of Nui Dat.' };

export const config: MapConfig = {
  center: [107.17, 10.55],
  zoom: 8,
  basemaps: [
    { id: 'terrain', name: 'Terrain', style: 'https://tiles.test/styles/terrain/style.json', tiles: [], tileSize: 256, attribution: null, default: true },
    { id: 'dark', name: 'Dark', style: 'https://tiles.test/styles/dark/style.json', tiles: [], tileSize: 256, attribution: null, default: false },
    { id: 'satellite', name: 'Satellite', style: '', tiles: ['https://tiles.test/sat/{z}/{y}/{x}.jpg'], tileSize: 256, attribution: 'Test imagery', default: false },
  ],
  overlays: [
    { id: 'topo', name: '1ATF topo', tiles: ['https://tiles.test/{z}/{x}/{y}.png'], tileSize: 256, attribution: null, opacity: 0.8 },
  ],
  terrain: { url: null, tiles: ['https://dem.test/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxZoom: 15, exaggeration: 1.5, attribution: null },
};

/** A stand-in for the map that records what the feature code asks of it. */
/** The map settles after the last move it was sent on: whatever was waiting for that ('moveend') goes ahead. */
export function arrive(map: { once: ReturnType<typeof vi.fn> }): void {
  const waiting = map.once.mock.calls.filter(([event]) => event === 'moveend').at(-1);
  if (!waiting) throw new Error('Nothing is waiting for the map to settle');
  (waiting[1] as () => void)();
}

export function fakeMap() {
  const sources = new Set<string>();
  const layers = new Set<string>();
  const setData = vi.fn();
  // Data set on any source other than the contacts (tracks, points of interest) is recorded per source, so `setData` stays
  // the record of what the map was told to draw for contacts.
  const otherData = new Map<string, ReturnType<typeof vi.fn>>();
  const dataFor = (id: string) => {
    if (!otherData.has(id)) otherData.set(id, vi.fn());
    return otherData.get(id)!;
  };
  return {
    sources,
    layers,
    setData,
    dataFor,
    getSource: (id: string) => (sources.has(id) ? { setData: id === 'avw-contacts' ? setData : dataFor(id) } : undefined),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    addSource: vi.fn((id: string, _spec?: unknown) => void sources.add(id)),
    addLayer: vi.fn((l: { id: string }) => void layers.add(l.id)),
    setFilter: vi.fn(),
    setPaintProperty: vi.fn(),
    hasImage: vi.fn(() => false),
    addImage: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    /** Where the map draws, for what is laid over it (the reticule that points out an incident). */
    container: document.createElement('div'),
    getContainer() {
      return this.container;
    },
    setLayoutProperty: vi.fn(),
    getCenter: () => ({ lat: 10.55, lng: 107.17 }),
    getZoom: () => 8,
    // A flat screen, 1000 pixels to the degree, so tests can reason about pixels.
    project: ([lon, lat]: [number, number]) => ({ x: lon * 1000, y: -lat * 1000 }),
    unproject: ([x, y]: [number, number]) => ({ lng: x / 1000, lat: -y / 1000 }),
    /** What is drawn under a point: nothing, unless a test says otherwise. */
    queryRenderedFeatures: vi.fn((_at?: unknown, _options?: unknown): { properties: Record<string, unknown> }[] => []),
  };
}

export class FakeBasemapService {
  readonly basemapId = signal<string | undefined>('terrain');
  readonly terrainEnabled = signal(false);
  readonly overlayIds = signal<readonly string[]>([]);
  readonly map = fakeMap();
  startedWith?: unknown;
  hooks?: MapHooks;
  private mapConfig?: MapConfig;
  create = vi.fn(async (_c: HTMLElement, cfg: MapConfig, start: { overlayOpacities?: ReadonlyMap<string, number> }, hooks: MapHooks) => {
    this.startedWith = start;
    this.mapConfig = cfg;
    this.overlayOpacities = new Map(start.overlayOpacities ?? []);
    this.hooks = hooks;
    hooks.styleLoaded(this.map as never);
    return this.map as never;
  });
  setBasemap = vi.fn();
  setTerrain = vi.fn();
  setOverlay = vi.fn();
  private overlayOpacities = new Map<string, number>();
  // Mirrors BasemapService.overlayOpacity: what was chosen, or the overlay's own configured default.
  overlayOpacity = vi.fn((id: string) => this.overlayOpacities.get(id) ?? this.mapConfig?.overlays.find((o) => o.id === id)?.opacity ?? 1);
  setOverlayOpacity = vi.fn((id: string, opacity: number) => void this.overlayOpacities.set(id, opacity));
  flyTo = vi.fn();
  fitTo = vi.fn();
  /** What runs when the map is clicked where none of the layers has anything. */
  backgroundClick?: () => void;
  bindBackgroundClick = vi.fn((_layers: readonly string[], handler: () => void) => {
    this.backgroundClick = handler;
  });
  clickHandler?: (p: Record<string, unknown>, at?: { lon: number; lat: number }) => void;
  /** The handler for every layer that was bound, by layer id. `clickHandler` is the one for the incident markers. */
  readonly handlers = new Map<string, (p: Record<string, unknown>, at?: { lon: number; lat: number }) => void>();
  bindClick = vi.fn((layer: string, handler: (p: Record<string, unknown>, at?: { lon: number; lat: number }) => void) => {
    this.handlers.set(layer, handler);
    if (layer === 'avw-contacts-points') this.clickHandler = handler;
  });
  /** What each layer's tooltip would hold, by layer id. */
  readonly tips = new Map<string, (p: Record<string, unknown>) => HTMLElement | null>();
  bindHover = vi.fn((layer: string, content: (p: Record<string, unknown>) => HTMLElement | null) => {
    this.tips.set(layer, content);
  });
}

export interface RenderOptions {
  config?: MapConfig | Error;
  contacts?: Contact[] | Error;
  /** The filter catalogue; an `Error` makes loading fail, and the map should carry on without filters. */
  catalogue?: FilterCatalogue | Error;
  /** Answers report searches. */
  search?: (text: string) => Promise<number[]>;
  /** Component inputs (the query parameters bound by the router). */
  inputs?: Record<string, string>;
  /** Points of interest; an `Error` makes loading fail, and the map should carry on without them. */
  pois?: Poi[] | Error;
  /** Overrides for the community API (notes, pictures, honour roll) the incident and honour panels talk to. */
  community?: Record<string, unknown>;
  /** Who is signed in; nobody by default. */
  user?: Parameters<typeof fakeAuth>[0];
  /** What the browser has kept from earlier visits (local storage), as a later visit would find it. */
  stored?: Record<string, string>;
  /** The raw query parameters the filters are read from. */
  queryParams?: Record<string, string | string[]>;
}

export const CHARTS: ChartInfo[] = [
  { id: 'battle-damage-date', title: 'Casualties over time', group: 'Casualties', description: 'Killed and wounded each day.', usesFilter: true },
  { id: 'age-at-death', title: 'Age at death, by service', group: 'Personnel', description: 'Average age at death.', usesFilter: false },
];

export const CHART: ChartResult = {
  id: 'battle-damage-date',
  title: 'Casualties over time',
  shape: 'Area',
  x: 'Time',
  xLabel: 'Date',
  yLabel: 'Casualties',
  categories: null,
  series: [{ name: 'Enemy killed', points: [[Date.UTC(1966, 2, 3), 3], [Date.UTC(1966, 2, 5), 7]] }],
  rows: 3,
  note: null,
};

export async function render(opts: RenderOptions = {}) {
  // What one test left shut (the panel, the legend) is remembered by the browser; each map starts as a first visit would.
  localStorage.clear();
  for (const [key, value] of Object.entries(opts.stored ?? {})) localStorage.setItem(key, value);
  const basemaps = new FakeBasemapService();
  const fail = (e: Error) => Promise.reject(e);
  const filterService = {
    load: vi.fn(() => (opts.catalogue instanceof Error ? fail(opts.catalogue) : Promise.resolve(opts.catalogue ?? CATALOGUE))),
    search: vi.fn(opts.search ?? (() => Promise.resolve([] as number[]))),
  };
  const poiService = {
    list: vi.fn(() => (opts.pois instanceof Error ? fail(opts.pois) : Promise.resolve(opts.pois ?? POIS))),
    detail: vi.fn((id: number) => Promise.resolve({ ...poiDetail, id })),
  };
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      ...(opts.queryParams ? [{ provide: ActivatedRoute, useValue: { snapshot: { queryParams: opts.queryParams } } }] : []),
      {
        provide: MapConfigService,
        useValue: { load: () => (opts.config instanceof Error ? fail(opts.config) : Promise.resolve(opts.config ?? config)) },
      },
      {
        provide: ContactsService,
        useValue: {
          load: () => (opts.contacts instanceof Error ? fail(opts.contacts) : Promise.resolve(opts.contacts ?? contacts)),
          detail: (id: number) => Promise.resolve({ ...detail, id }),
        },
      },
      { provide: FilterCatalogueService, useValue: filterService },
      { provide: PoiService, useValue: poiService },
    ],
  });
  const analytics = {
    charts: vi.fn(() => Promise.resolve(CHARTS)),
    draw: vi.fn((id: string, _ids: readonly number[] | null) => Promise.resolve({ ...CHART, id })),
  };
  const community = fakeCommunity(opts.community);
  const auth = fakeAuth(opts.user);
  TestBed.configureTestingModule({ providers: [{ provide: AnalyticsService, useValue: analytics }, ...communityProviders(community, auth)] });
  stubEchartIn(Timeline);
  stubEchartIn(AnalyticsPanel);
  TestBed.overrideComponent(Battlemap, {
    set: {
      providers: [{ provide: BasemapService, useValue: basemaps }, MapSelectionService, MapViewStateService, UnitFollowService, ContactFilteringService, PicturePlacementService],
    },
  });
  const fixture = TestBed.createComponent(Battlemap);
  for (const [k, v] of Object.entries(opts.inputs ?? {})) {
    fixture.componentRef.setInput(k, v);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r));
  fixture.detectChanges();
  return { fixture, basemaps, filterService, poiService, analytics, community, auth, el: fixture.nativeElement as HTMLElement };
}

/** Lets pending promises and a change-detection pass settle. */
export async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r));
  fixture.detectChanges();
}
