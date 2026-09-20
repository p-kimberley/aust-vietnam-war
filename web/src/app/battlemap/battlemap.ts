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
import { AnalyticsPanel } from './analytics/analytics-panel';
import { DateRange, Timeline } from './analytics/timeline';
import { BasemapService } from './basemap.service';
import { IncidentPanel } from './incident-panel';
import { Poi, PoiService } from './poi';
import { POI_POINTS, addPoiLayers, setPoiVisibility, setSelectedPoi } from './poi-layers';
import { CommunityService, IncidentMediaView } from './community/community';
import { HonourPanel } from './community/honour-panel';
import { PHOTO_CLUSTERS, PHOTO_POINTS, addPhotoLayers, setPhotoVisibility, setSelectedPhoto, zoomIntoCluster } from './photo-layers';
import { PicturePanel } from './picture-panel';
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
import { MAX_SEPARATE_TRACKS, Track, addTrackLayers, buildTracks, neighbour, setTrackVisibility, setTracks } from './track';
import { UnitTree } from './unit-tree';

type Status = 'loading' | 'ready' | 'error';
type Tab = 'layers' | 'filters';

/** How long typing must pause before the report search is sent. */
const SEARCH_DELAY_MS = 400;

/**
 * The Battle Map (client-only route). Loads the runtime map catalogue, every contact and the filter catalogue, then
 * draws a heatmap and incident markers on a MapLibre GL map. Filters run in the browser over the loaded contacts (the
 * dataset is small); only the incident-report word search goes to the server. The view is kept in the URL (`?at=`,
 * `?basemap=`, `?terrain=`, `?field=`, `?overlays=`, `?incident=`, `?poi=`, `?picture=` and the filter parameters described in
 * `filters.ts`) so a link reproduces what the sender was looking at.
 */
@Component({
  selector: 'app-battlemap',
  imports: [RouterLink, IncidentPanel, PoiPanel, PicturePanel, HonourPanel, FiltersPanel, SearchBox, AnalyticsPanel, Timeline],
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
  readonly picture = input<string>();
  readonly charts = input<string>();
  readonly track = input<string>();
  readonly person = input<string>();

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly configService = inject(MapConfigService);
  private readonly contactsService = inject(ContactsService);
  private readonly filterService = inject(FilterCatalogueService);
  private readonly poiService = inject(PoiService);
  private readonly community = inject(CommunityService);
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
  /** The service number of the person on the honour roll whose panel is open. */
  protected readonly selectedPerson = signal<string | null>(null);
  protected readonly pois = signal<readonly Poi[]>([]);
  protected readonly showPois = signal(true);
  /** Community pictures that have a place on the map. */
  protected readonly pictures = signal<readonly IncidentMediaView[]>([]);
  protected readonly showPhotos = signal(true);
  protected readonly selectedPictureId = signal<number | null>(null);
  /** The tab an incident opens on. Search sends a note's reader straight to the notes; anything else starts on the details. */
  protected readonly incidentTab = signal<'details' | 'notes'>('details');
  protected readonly tab = signal<Tab>('layers');
  protected readonly panelOpen = signal(true);
  protected readonly showHeatmap = signal(true);
  protected readonly showMarkers = signal(true);
  protected readonly heatField = signal<HeatField>(DEFAULT_HEAT_FIELD);
  protected readonly heatFields = HEAT_FIELDS;
  /** The charts drawer, opened from the top bar. */
  protected readonly chartsOpen = signal(false);
  /** Draws the path of each chosen unit, contact by contact in date order. */
  protected readonly showTrack = signal(false);
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
  /** The ids the charts are drawn from: what the map shows. */
  protected readonly visibleIds = computed(() => this.visible().map((c) => c.id));
  protected readonly tracks = computed<Track[]>(() => (this.showTrack() ? buildTracks(this.visible(), this.filters().units) : []));
  protected readonly maxTracks = MAX_SEPARATE_TRACKS;
  /** With exactly one unit followed, its incidents can be stepped through one by one. */
  protected readonly singleTrack = computed(() => (this.tracks().length === 1 ? this.tracks()[0] : null));

  constructor() {
    afterNextRender(() => void this.start());
  }

  /** Opens the incident panel for a contact (or closes it), ringing the marker and keeping the URL in step. */
  protected select(id: number | null): void {
    this.incidentTab.set('details');
    this.selectedId.set(id);
    if (id !== null) {
      this.selectedPoiId.set(null);
      this.selectedPerson.set(null);
      this.selectedPictureId.set(null);
    }
    if (this.map) {
      setSelectedContact(this.map, id);
      if (id !== null) {
        setSelectedPoi(this.map, null);
        setSelectedPhoto(this.map, null);
      }
    }
    this.syncUrl();
  }

  /** Opens the panel for a point of interest (or closes it). One panel is open at a time, so this closes the incident panel. */
  protected selectPoi(id: number | null): void {
    this.selectedPoiId.set(id);
    if (id !== null) {
      this.selectedId.set(null);
      this.selectedPerson.set(null);
      this.selectedPictureId.set(null);
    }
    if (this.map) {
      setSelectedPoi(this.map, id);
      if (id !== null) {
        setSelectedContact(this.map, null);
        setSelectedPhoto(this.map, null);
      }
    }
    this.syncUrl();
  }

  /** Opens the panel for a community picture (or closes it), in place of whatever else is open. */
  protected selectPicture(id: number | null): void {
    this.selectedPictureId.set(id);
    if (id !== null) {
      this.selectedId.set(null);
      this.selectedPoiId.set(null);
      this.selectedPerson.set(null);
    }
    if (this.map) {
      setSelectedPhoto(this.map, id);
      if (id !== null) {
        setSelectedContact(this.map, null);
        setSelectedPoi(this.map, null);
      }
    }
    this.syncUrl();
  }

  /** Opens a person's page on the honour roll (or closes it), in place of whatever else is open. */
  protected openPerson(serviceNumber: string | null): void {
    this.selectedPerson.set(serviceNumber);
    if (serviceNumber !== null) {
      this.selectedId.set(null);
      this.selectedPoiId.set(null);
      this.selectedPictureId.set(null);
      if (this.map) {
        setSelectedContact(this.map, null);
        setSelectedPoi(this.map, null);
        setSelectedPhoto(this.map, null);
      }
    }
    this.syncUrl();
  }

  /** Opens the incident chosen from the search results and brings it into view. */
  protected openContact(id: number): void {
    const contact = this.allContacts().find((c) => c.id === id);
    this.select(id);
    if (contact) this.basemaps.flyTo(contact.lat, contact.lon, 13);
  }

  /** Opens the incident a found note is about, on its notes tab. */
  protected openNote(contactId: number): void {
    this.openContact(contactId);
    this.incidentTab.set('notes');
  }

  /** Opens a photo (found by search, or taken near an incident) and brings its place into view. */
  protected openPictureAt(picture: { id: number; lat: number | null; lon: number | null }): void {
    this.selectPicture(picture.id);
    if (picture.lat !== null && picture.lon !== null) this.basemaps.flyTo(picture.lat, picture.lon, 14);
  }

  /** Opens the base chosen from the search results and brings it into view. */
  protected openPoi(id: number): void {
    const poi = this.pois().find((p) => p.id === id);
    this.selectPoi(id);
    if (poi) this.basemaps.flyTo(poi.lat, poi.lon, 13);
  }

  protected setPhotosVisible(visible: boolean): void {
    this.showPhotos.set(visible);
    if (this.map) setPhotoVisibility(this.map, visible);
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

  /** The timeline sets the same date filter as the filter panel does. */
  protected setDateRange(range: DateRange): void {
    this.setFilters({ ...this.filters(), from: range.from, to: range.to });
  }

  protected setChartsOpen(open: boolean): void {
    this.chartsOpen.set(open);
    this.syncUrl();
  }

  /** Opens the previous or next incident of the followed unit, flying to it. */
  protected stepTrack(direction: 1 | -1): void {
    const track = this.singleTrack();
    const next = track ? neighbour(track, this.selectedId(), direction) : null;
    if (next) {
      this.openContact(next.id);
    }
  }

  protected setTrackVisible(visible: boolean): void {
    this.showTrack.set(visible);
    if (this.map) {
      setTracks(this.map, this.tracks());
      setTrackVisibility(this.map, visible);
    }
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
      const [config, contacts, catalogue, pois, pictures] = await Promise.all([
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
        // So are the community pictures.
        this.community.mediaOnMap().catch((e) => {
          console.warn('The community pictures could not be loaded', e);
          return [] as IncidentMediaView[];
        }),
      ]);
      this.pois.set(pois);
      this.pictures.set(pictures.filter((p) => p.lat !== null && p.lon !== null));
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

      // A link may open onto a person on the honour roll, unless it already names an incident or a base.
      if (this.person() && !this.incident() && !this.poi() && !this.picture()) {
        this.selectedPerson.set(this.person()!);
      }

      this.chartsOpen.set(this.charts() === '1');
      this.showTrack.set(this.track() === '1');

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

      // A link may open onto a picture on the map, unless it already names an incident or a base.
      const requestedPicture = Number(this.picture());
      const openedPicture =
        !opened && !openedPoi && Number.isInteger(requestedPicture) ? this.pictures().find((p) => p.id === requestedPicture) : undefined;
      if (openedPicture) {
        this.selectedPictureId.set(openedPicture.id);
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
            addTrackLayers(map, this.tracks(), this.showTrack());
            // Pictures last, so they draw over the contacts.
            addPhotoLayers(map, this.pictures(), { visible: this.showPhotos(), selectedId: this.selectedPictureId() });
            if (firstStyle) {
              firstStyle = false;
              // Registered in this order so that, where a contact sits on a base, the contact (drawn on top) wins.
              this.basemaps.bindClick(POI_POINTS, (p) => this.selectPoi(Number(p['id'])));
              this.basemaps.bindClick(POINT_LAYER, (p) => this.select(Number(p['id'])));
              // Pictures are drawn on top, so they are registered last and win where they overlap a contact.
              this.basemaps.bindClick(PHOTO_POINTS, (p) => this.selectPicture(Number(p['id'])));
              this.basemaps.bindClick(PHOTO_CLUSTERS, (p, at) => void zoomIntoCluster(map, Number(p['cluster_id']), at));
              this.status.set('ready');
            }
          },
          cameraChanged: () => this.syncUrl(),
          failed: (message) => this.fail(message),
        },
      );

      // With no explicit view in the link, bring the incident into frame.
      const target = opened ?? openedPoi ?? openedPicture;
      if (target && !parseAt(this.at())) {
        this.basemaps.flyTo(target.lat!, target.lon!, 11);
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
    setTracks(map, this.tracks());
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
          picture: this.selectedPictureId(),
          person: this.selectedPerson(),
          charts: this.chartsOpen() ? '1' : null,
          track: this.showTrack() ? '1' : null,
          ...(tree ? toParams(this.filters(), tree) : {}),
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }, 400);
  }
}
