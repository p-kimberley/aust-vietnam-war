import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { BasemapService } from './basemap.service';
import { IncidentPanel } from './incident-panel';
import { Poi, PoiService } from './poi';
import { POI_POINTS, addPoiLayers, setPoiVisibility, setSelectedPoi } from './poi-layers';
import { PoiPanel } from './poi-panel';
import { SearchBox } from './search-box';
import {
  HEAT_LAYER,
  POINT_LAYER,
  addContactLayers,
  setContactVisibility,
  setContacts,
  setHeatField,
  setSelectedContact,
} from './contact-layers';
import { Contact, DEFAULT_HEAT_FIELD, HEAT_FIELDS, HeatField, fieldRange, isHeatField } from './contacts';
import { ContactsService } from './contacts.service';
import { FilterCatalogue, FilterCatalogueService } from './filter-catalogue';
import { FiltersPanel, TextStatus } from './filters-panel';
import { FilterState, MIN_TEXT_LENGTH, NO_FILTERS, activeKeys, applyFilters, fromParams, hasText, toParams } from './filters';
import { MapConfig, MapConfigService } from './map-config';
import { Camera, formatAt, parseAt } from './map-url';
import { UnitTree } from './unit-tree';

type Status = 'loading' | 'ready' | 'error';
type Tab = 'layers' | 'filters';

/** How long typing must pause before the report search is sent. */
const SEARCH_DELAY_MS = 400;

/**
 * The Battle Map (client-only route). Loads the runtime map catalogue, every contact and the filter catalogue, then
 * draws a heatmap and incident markers on a MapLibre GL map. Filters run in the browser over the loaded contacts (the
 * dataset is small); only the incident-report word search goes to the server. The view is kept in the URL (`?at=`,
 * `?basemap=`, `?terrain=`, `?field=`, `?overlays=`, `?incident=`, `?poi=` and the filter parameters described in
 * `filters.ts`) so a link reproduces what the sender was looking at.
 */
@Component({
  selector: 'app-battlemap',
  imports: [RouterLink, IncidentPanel, PoiPanel, FiltersPanel, SearchBox],
  providers: [BasemapService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './battlemap.html',
  styleUrl: './battlemap.css',
})
export class Battlemap {
  // Bound from the query string by the router (withComponentInputBinding). Read once, on start.
  readonly at = input<string>();
  readonly basemap = input<string>();
  readonly terrain = input<string>();
  readonly field = input<string>();
  readonly overlays = input<string>();
  readonly incident = input<string>();
  readonly poi = input<string>();

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly configService = inject(MapConfigService);
  private readonly contactsService = inject(ContactsService);
  private readonly filterService = inject(FilterCatalogueService);
  private readonly poiService = inject(PoiService);
  protected readonly basemaps = inject(BasemapService);
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');

  private map?: MapLibreMap;
  private urlTimer?: ReturnType<typeof setTimeout>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  /** Identifies the latest search, so a slow answer to an older one is dropped. */
  private searchSeq = 0;

  protected readonly status = signal<Status>('loading');
  protected readonly message = signal('');
  protected readonly config = signal<MapConfig | null>(null);
  protected readonly selectedId = signal<number | null>(null);
  protected readonly selectedPoiId = signal<number | null>(null);
  protected readonly pois = signal<readonly Poi[]>([]);
  protected readonly showPois = signal(true);
  protected readonly tab = signal<Tab>('layers');
  protected readonly panelOpen = signal(true);
  protected readonly showHeatmap = signal(true);
  protected readonly showMarkers = signal(true);
  protected readonly heatField = signal<HeatField>(DEFAULT_HEAT_FIELD);
  protected readonly heatFields = HEAT_FIELDS;
  protected readonly canTerrain = computed(() => !!this.config()?.terrain);

  // ---- filters
  protected readonly allContacts = signal<readonly Contact[]>([]);
  protected readonly catalogue = signal<FilterCatalogue | null>(null);
  protected readonly tree = computed(() => {
    const c = this.catalogue();
    return c ? new UnitTree(c.units) : null;
  });
  protected readonly filters = signal<FilterState>(NO_FILTERS);
  /** Contacts whose report matches the search text; `null` before the first answer, or when there is no text. */
  protected readonly textIds = signal<ReadonlySet<number> | null>(null);
  protected readonly textStatus = signal<TextStatus>('idle');
  /** The contacts that pass the filters: what is drawn on the map. */
  protected readonly visible = computed(() => {
    const c = this.catalogue();
    return c ? applyFilters(this.allContacts(), this.filters(), c, this.textIds()) : this.allContacts();
  });
  protected readonly unitCounts = computed(() => this.tree()?.countContacts(this.allContacts()) ?? new Map<number, number>());
  protected readonly activeCount = computed(() => activeKeys(this.filters()).length);

  constructor() {
    afterNextRender(() => void this.start());
  }

  /** Opens the incident panel for a contact (or closes it), ringing the marker and keeping the URL in step. */
  protected select(id: number | null): void {
    this.selectedId.set(id);
    if (id !== null) this.selectedPoiId.set(null);
    if (this.map) {
      setSelectedContact(this.map, id);
      if (id !== null) setSelectedPoi(this.map, null);
    }
    this.syncUrl();
  }

  /** Opens the panel for a point of interest (or closes it). One panel is open at a time, so this closes the incident panel. */
  protected selectPoi(id: number | null): void {
    this.selectedPoiId.set(id);
    if (id !== null) this.selectedId.set(null);
    if (this.map) {
      setSelectedPoi(this.map, id);
      if (id !== null) setSelectedContact(this.map, null);
    }
    this.syncUrl();
  }

  /** Opens the incident chosen from the search results and brings it into view. */
  protected openContact(id: number): void {
    const contact = this.allContacts().find((c) => c.id === id);
    this.select(id);
    if (contact) this.basemaps.flyTo(contact.lat, contact.lon, 13);
  }

  /** Opens the base chosen from the search results and brings it into view. */
  protected openPoi(id: number): void {
    const poi = this.pois().find((p) => p.id === id);
    this.selectPoi(id);
    if (poi) this.basemaps.flyTo(poi.lat, poi.lon, 13);
  }

  protected setPoisVisible(visible: boolean): void {
    this.showPois.set(visible);
    if (this.map) setPoiVisibility(this.map, visible);
  }

  protected showTab(tab: Tab): void {
    this.tab.set(tab);
    this.panelOpen.set(true);
  }

  protected setBasemap(id: string): void {
    this.basemaps.setBasemap(id);
    this.syncUrl();
  }

  protected setTerrain(enabled: boolean): void {
    this.basemaps.setTerrain(enabled);
    this.syncUrl();
  }

  protected setOverlay(id: string, enabled: boolean): void {
    this.basemaps.setOverlay(id, enabled);
    this.syncUrl();
  }

  protected setHeatmapVisible(visible: boolean): void {
    this.showHeatmap.set(visible);
    if (this.map) setContactVisibility(this.map, HEAT_LAYER, visible);
  }

  protected setMarkersVisible(visible: boolean): void {
    this.showMarkers.set(visible);
    if (this.map) setContactVisibility(this.map, POINT_LAYER, visible);
  }

  protected setHeatField(value: string): void {
    if (!isHeatField(value)) {
      return;
    }
    this.heatField.set(value);
    this.refreshContacts();
    this.syncUrl();
  }

  /** Applies a change from the filter panel: redraws the map, starts a report search if the text changed, updates the URL. */
  protected setFilters(next: FilterState): void {
    const changedText = next.text !== this.filters().text;
    this.filters.set(next);
    if (changedText) {
      this.queueSearch(next.text);
    }
    this.refreshContacts();
    this.syncUrl();
  }

  private async start(): Promise<void> {
    try {
      const [config, contacts, catalogue, pois] = await Promise.all([
        this.configService.load(),
        this.contactsService.load(),
        // Without the catalogue the map still works, just without filters.
        this.filterService.load().catch((e) => {
          console.warn('The filter catalogue could not be loaded', e);
          return null;
        }),
        // Points of interest are extra: the map is complete without them.
        this.poiService.list().catch((e) => {
          console.warn('The points of interest could not be loaded', e);
          return [] as Poi[];
        }),
      ]);
      this.pois.set(pois);
      this.config.set(config);
      this.allContacts.set(contacts);

      if (catalogue) {
        this.catalogue.set(catalogue);
        this.filters.set(fromParams(this.route.snapshot.queryParams, catalogue, this.tree()!));
        if (hasText(this.filters())) {
          await this.searchNow(this.filters().text);
        }
        if (this.activeCount() > 0) {
          this.tab.set('filters');
        }
      }

      const field = this.field();
      if (field && isHeatField(field)) {
        this.heatField.set(field);
      }

      // A shared link may open straight onto an incident. Ignore ids that are not real contacts.
      const requested = Number(this.incident());
      const opened = Number.isInteger(requested) ? contacts.find((c) => c.id === requested) : undefined;
      if (opened) {
        this.selectedId.set(opened.id);
      }

      // A link may open onto a point of interest instead. Ignore ids that are not real points.
      const requestedPoi = Number(this.poi());
      const openedPoi = !opened && Number.isInteger(requestedPoi) ? pois.find((p) => p.id === requestedPoi) : undefined;
      if (openedPoi) {
        this.selectedPoiId.set(openedPoi.id);
      }

      let firstStyle = true;
      this.map = await this.basemaps.create(
        this.canvas().nativeElement,
        config,
        {
          basemapId: this.basemap(),
          camera: parseAt(this.at()),
          terrain: this.terrain() === '1',
          overlays: (this.overlays() ?? '').split(',').filter(Boolean),
        },
        {
          styleLoaded: (map) => {
            const shown = this.visible();
            // Points of interest first, so contacts draw over them.
            addPoiLayers(map, this.pois(), { visible: this.showPois(), selectedId: this.selectedPoiId() });
            addContactLayers(map, shown, this.heatField(), fieldRange(shown, this.heatField()), {
              heatmap: this.showHeatmap(),
              markers: this.showMarkers(),
              selectedId: this.selectedId(),
            });
            if (firstStyle) {
              firstStyle = false;
              // Registered in this order so that, where a contact sits on a base, the contact (drawn on top) wins.
              this.basemaps.bindClick(POI_POINTS, (p) => this.selectPoi(Number(p['id'])));
              this.basemaps.bindClick(POINT_LAYER, (p) => this.select(Number(p['id'])));
              this.status.set('ready');
            }
          },
          cameraChanged: () => this.syncUrl(),
          failed: (message) => this.fail(message),
        },
      );

      // With no explicit view in the link, bring the incident into frame.
      const target = opened ?? openedPoi;
      if (target && !parseAt(this.at())) {
        this.basemaps.flyTo(target.lat, target.lon, 11);
      }
    } catch (e) {
      console.error('Battle Map failed to start', e);
      this.fail('The Battle Map could not be loaded. Please try again shortly.');
    }
  }

  /** Puts the filtered contacts on the map and rescales the heatmap to them, so a small subset still shows its hotspots. */
  private refreshContacts(): void {
    const map = this.map;
    if (!map) {
      return;
    }
    const shown = this.visible();
    setContacts(map, shown);
    setHeatField(map, this.heatField(), fieldRange(shown, this.heatField()));
  }

  /** Waits for typing to pause, then asks the server which reports contain the words. */
  private queueSearch(text: string): void {
    clearTimeout(this.searchTimer);
    const seq = ++this.searchSeq;
    const words = text.trim();
    if (words.length < MIN_TEXT_LENGTH) {
      this.textIds.set(null);
      this.textStatus.set('idle');
      return;
    }
    this.textStatus.set('searching');
    this.searchTimer = setTimeout(() => void this.runSearch(words, seq), SEARCH_DELAY_MS);
  }

  private searchNow(text: string): Promise<void> {
    return this.runSearch(text.trim(), ++this.searchSeq);
  }

  private async runSearch(words: string, seq: number): Promise<void> {
    try {
      const ids = await this.filterService.search(words);
      if (seq !== this.searchSeq) return;
      this.textIds.set(new Set(ids));
      this.textStatus.set('ready');
    } catch (e) {
      if (seq !== this.searchSeq) return;
      console.warn('The report search failed', e);
      this.textIds.set(null);
      this.textStatus.set('error');
    }
    this.refreshContacts();
  }

  private fail(message: string): void {
    this.message.set(message);
    this.status.set('error');
  }

  /** Writes the current view into the query string, without adding history entries or spamming while panning. */
  private syncUrl(): void {
    clearTimeout(this.urlTimer);
    this.urlTimer = setTimeout(() => {
      const map = this.map;
      if (!map) {
        return;
      }
      const c = map.getCenter();
      const camera: Camera = { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
      const basemapId = this.basemaps.basemapId();
      const defaultBasemap = this.config()?.basemaps.find((b) => b.default)?.id;
      const tree = this.tree();
      void this.router.navigate([], {
        queryParams: {
          at: formatAt(camera),
          basemap: basemapId && basemapId !== defaultBasemap ? basemapId : null,
          terrain: this.basemaps.terrainEnabled() ? '1' : null,
          field: this.heatField() !== DEFAULT_HEAT_FIELD ? this.heatField() : null,
          overlays: this.basemaps.overlayIds().join(',') || null,
          incident: this.selectedId(),
          poi: this.selectedPoiId(),
          ...(tree ? toParams(this.filters(), tree) : {}),
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }, 400);
  }
}
