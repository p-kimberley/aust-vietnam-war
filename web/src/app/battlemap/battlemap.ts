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
import { DateRange, Timeline, TimelineFocus } from './analytics/timeline';
import { BasemapPicker } from './basemap-picker';
import { LeftTab, LeftTabs } from './left-tabs';
import { MapLegend } from './map-legend';
import { NominalRoll } from './nominal-roll';
import { BasemapService } from './basemap.service';
import { IncidentPanel } from './incident-panel';
import { Poi, PoiService } from './poi';
import { POI_POINTS, addPoiLayers, setPoiVisibility, setSelectedPoi } from './poi-layers';
import { CommunityService, IncidentMediaView } from './community/community';
import { HonourPanel } from './community/honour-panel';
import { PHOTO_CLUSTERS, PHOTO_IMAGES, PHOTO_POINTS, PHOTO_FULL_ZOOM, addPhotoLayers, setPhotoVisibility, setSelectedPhoto, zoomIntoCluster } from './photo-layers';
import { PicturePanel } from './picture-panel';
import { PoiPanel } from './poi-panel';
import { SearchBox } from './search-box';
import {
  HEAT_LAYER,
  MarkerSizing,
  POINT_LAYER,
  addContactLayers,
  setContactVisibility,
  setContacts,
  setHeatField,
  setMarkerSizing,
  setSelectedContact,
} from './contact-layers';
import {
  Contact,
  DEFAULT_HEAT_FIELD,
  HEAT_FIELDS,
  HeatField,
  SIZE_FIELDS,
  SizeField,
  fieldRange,
  isHeatField,
  isSizeField,
  sizeCap,
} from './contacts';
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
/** How long the fly-out takes to slide away; its panel is put away when it has gone. */
const FLYOUT_SLIDE_MS = 300;
/** A filter that leaves one contact, or a few close together, zooms no closer than this. */
const FIT_MAX_ZOOM = 13;

/**
 * The Battle Map (client-only route). Loads the runtime map catalogue, every contact and the filter catalogue, then
 * draws a heatmap and incident markers on a MapLibre GL map. Filters run in the browser over the loaded contacts (the
 * dataset is small); only the incident-report word search goes to the server. The view is kept in the URL (`?at=`,
 * `?basemap=`, `?terrain=`, `?field=`, `?overlays=`, `?incident=`, `?poi=`, `?picture=` and the filter parameters described in
 * `filters.ts`) so a link reproduces what the sender was looking at.
 */
@Component({
  selector: 'app-battlemap',
  imports: [RouterLink, BasemapPicker, LeftTabs, MapLegend, NominalRoll, IncidentPanel, PoiPanel, PicturePanel, HonourPanel, FiltersPanel, SearchBox, AnalyticsPanel, Timeline],
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
  readonly size = input<string>();
  readonly overlays = input<string>();
  readonly incident = input<string>();
  readonly poi = input<string>();
  readonly picture = input<string>();
  readonly charts = input<string>();
  readonly roll = input<string>();
  readonly track = input<string>();
  readonly follow = input<string>();
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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
  protected readonly heatFieldName = computed(() => HEAT_FIELDS.find((f) => f.value === this.heatField())?.name ?? '');
  /** What point markers are scaled by; null draws them all the same size. */
  protected readonly sizeField = signal<SizeField | null>(null);
  protected readonly sizeFields = SIZE_FIELDS;
  protected readonly sizeFieldName = computed(() => SIZE_FIELDS.find((f) => f.value === this.sizeField())?.name ?? null);
  /** The types of point on the map, for the legend; none while the layer is switched off. */
  protected readonly legendPoiTypes = computed(() => (this.showPois() ? [...new Set(this.pois().map((p) => p.type))] : []));
  /** The charts drawer, opened from the top bar. */
  /** The tools in the rail at the left. A new one is a new entry here and a new case in the fly-out in the template. */
  protected readonly leftTabs: readonly LeftTab[] = [
    { id: 'charts', label: 'Charts' },
    { id: 'roll', label: 'Nominal roll' },
  ];
  /** The tool that is flown out at the left, or `null` when none is. */
  protected readonly flyout = signal<string | null>(null);
  /** What the fly-out holds. It stays through the slide out, so the panel does not vanish before it has gone. */
  protected readonly flyoutShown = signal<string | null>(null);
  private flyoutTimer?: ReturnType<typeof setTimeout>;
  /** The operation timeline, opened from the arrow on the timeline's top edge. */
  protected readonly timelineOpen = signal(false);
  /** Play is moving the timeline's window on. */
  protected readonly timelinePlaying = signal(false);
  /** The incident open in the panel, as the operation timeline needs it: when it happened and which operation it belongs to. */
  protected readonly timelineFocus = computed<TimelineFocus | null>(() => {
    const id = this.selectedId();
    const contact = id === null ? undefined : this.allContacts().find((c) => c.id === id);
    if (!contact) {
      return null;
    }
    const operation = contact.op > 0 ? (this.catalogue()?.operations[contact.op - 1]?.name ?? null) : null;
    return { date: contact.dtg, operation };
  });
  /** The units whose paths are drawn, contact by contact in date order. Chosen with the button beside each unit in the incident panel. */
  protected readonly followed = signal<ReadonlySet<number>>(new Set());
  /** A panel is open at the right, so what else sits there moves aside. */
  protected readonly rightPanelOpen = computed(
    () => this.selectedId() !== null || this.selectedPoiId() !== null || this.selectedPictureId() !== null || this.selectedPerson() !== null,
  );
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
  /**
   * The contacts the operation list is drawn from: what the filters leave, except that the operation choice itself is ignored
   * (or, once one operation was chosen, no other could be added) and so are the dates (the list has its own time axis). So
   * choosing a unit, a task or a data source lists just the operations that have contacts of that unit, task or source.
   */
  protected readonly operationScope = computed(() => {
    const c = this.catalogue();
    return c ? applyFilters(this.allContacts(), { ...this.filters(), operations: new Set(), from: null, to: null }, c, this.textIds()) : this.allContacts();
  });
  protected readonly unitCounts = computed(() => this.tree()?.countContacts(this.allContacts()) ?? new Map<number, number>());
  protected readonly activeCount = computed(() => activeKeys(this.filters()).length);
  /** The ids the charts are drawn from: what the map shows. */
  protected readonly visibleIds = computed(() => this.visible().map((c) => c.id));
  protected readonly tracks = computed<Track[]>(() => buildTracks(this.visible(), this.followed()));
  /** What the incident panel shows beside a followed unit: the colour of its line, and how many incidents it has. */
  protected readonly followInfo = computed(() => new Map(this.tracks().map((t) => [t.key, { colour: t.colour, stops: t.stops.length }])));
  /** Paths of more units than this would only tangle, so no more can be followed. */
  protected readonly followFull = computed(() => this.followed().size >= MAX_SEPARATE_TRACKS);

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

  /** A click on empty map closes whatever the map opened: the incident, the base or the photo. */
  protected clearMapSelection(): void {
    if (this.selectedId() !== null) {
      this.select(null);
    }
    if (this.selectedPoiId() !== null) {
      this.selectPoi(null);
    }
    if (this.selectedPictureId() !== null) {
      this.selectPicture(null);
    }
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
    if (picture.lat !== null && picture.lon !== null) this.basemaps.flyTo(picture.lat, picture.lon, PHOTO_FULL_ZOOM);
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

  /** Marker sizes are absolute: the cap comes from every contact, not just the filtered ones, so a marker does not change size as filters change. */
  private markerSizing(): MarkerSizing {
    const field = this.sizeField();
    return { field, cap: field ? sizeCap(this.allContacts(), field) : 0 };
  }

  protected setMarkerSize(value: string): void {
    const field = isSizeField(value) ? value : null;
    this.sizeField.set(field);
    if (this.map) setMarkerSizing(this.map, this.markerSizing());
    this.syncUrl();
  }

  /** Chooses an operation as a filter, or takes it off again; any number can be chosen. */
  protected toggleOperation(name: string): void {
    const operations = new Set(this.filters().operations);
    if (!operations.delete(name)) {
      operations.add(name);
    }
    this.setFilters({ ...this.filters(), operations });
  }

  /** The timeline sets the same date filter as the filter panel does. */
  protected setDateRange(range: DateRange): void {
    this.setFilters({ ...this.filters(), from: range.from, to: range.to });
  }

  /** Flies a tool out from the left, or puts it away. */
  protected setFlyout(id: string | null): void {
    clearTimeout(this.flyoutTimer);
    this.flyout.set(id);
    if (id !== null) {
      this.flyoutShown.set(id);
    } else {
      this.flyoutTimer = setTimeout(() => this.flyoutShown.set(null), FLYOUT_SLIDE_MS);
    }
    this.syncUrl();
  }

  /** Follows a unit, or stops following it. */
  protected toggleFollow(unit: number): void {
    const next = new Set(this.followed());
    if (!next.delete(unit)) {
      if (next.size >= MAX_SEPARATE_TRACKS) {
        return;
      }
      next.add(unit);
    }
    this.setFollowed(next);
  }

  protected stopFollowing(): void {
    this.setFollowed(new Set());
  }

  /** The paths show whenever any unit is followed, and only then. */
  private setFollowed(units: ReadonlySet<number>): void {
    this.followed.set(units);
    if (this.map) {
      setTracks(this.map, this.tracks());
      setTrackVisibility(this.map, units.size > 0);
    }
    this.syncUrl();
  }

  /** `follow=` lists unit ids. An older link's `track=1` followed whichever units the filters had chosen. */
  private followedFromLink(): ReadonlySet<number> {
    const ids = (this.follow() ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const units = ids.length ? new Set(ids) : this.track() === '1' ? new Set(this.filters().units) : new Set<number>();
    return units.size <= MAX_SEPARATE_TRACKS ? units : new Set();
  }

  /** Opens the previous or next incident of a followed unit, flying to it. */
  protected stepFollowed(unit: number, direction: 1 | -1): void {
    const track = this.tracks().find((t) => t.key === unit);
    const next = track ? neighbour(track, this.selectedId(), direction) : null;
    if (next) {
      this.openContact(next.id);
    }
  }

  /** Applies a change from the filter panel: redraws the map, starts a report search if the text changed, updates the URL. */
  protected setFilters(next: FilterState): void {
    const changedText = next.text !== this.filters().text;
    this.filters.set(next);
    // The reader chose a filter, so once the contacts it leaves are drawn the map zooms to them. A report search answers later, so
    // its zoom waits for the answer. Play moves the window on every few hundred milliseconds, and a camera that followed each
    // step would be dizzying, so it is left where it is.
    if (!this.timelinePlaying()) {
      this.fitRequest = changedText && hasText(next) ? 'search' : 'now';
    }
    if (changedText) {
      this.queueSearch(next.text);
    }
    this.refreshContacts();
    this.syncUrl();
  }

  /** What the map is waiting to zoom to: the contacts a filter has left, now or when the report search has answered. */
  private fitRequest: 'now' | 'search' | null = null;

  /** How much of the map the panels and the timeline cover, so that the contacts land in the part that is left. */
  private mapPadding(): { top: number; bottom: number; left: number; right: number } {
    const root = this.host.nativeElement.getBoundingClientRect();
    const timeline = this.host.nativeElement.querySelector('.bm__timeline')?.getBoundingClientRect();
    const panels = [...this.host.nativeElement.querySelectorAll('.bm__right, .bm__incident')].map((e) => e.getBoundingClientRect().left);
    const padding = {
      top: 64,
      left: 32,
      bottom: (timeline ? Math.max(root.bottom - timeline.top, 0) : 0) + 24,
      right: (panels.length ? Math.max(root.right - Math.min(...panels), 0) : 0) + 24,
    };
    // Padding that leaves no room for the map cannot be used.
    const fits = padding.left + padding.right < root.width && padding.top + padding.bottom < root.height;
    return root.width === 0 || fits ? padding : { top: 32, left: 32, bottom: 32, right: 32 };
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

      const tool = this.charts() === '1' ? 'charts' : this.roll() === '1' ? 'roll' : null;
      this.flyout.set(tool);
      this.flyoutShown.set(tool);
      this.followed.set(this.followedFromLink());

      const field = this.field();
      if (field && isHeatField(field)) {
        this.heatField.set(field);
      }
      const size = this.size();
      if (size && isSizeField(size)) {
        this.sizeField.set(size);
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
              sizing: this.markerSizing(),
            });
            addTrackLayers(map, this.tracks(), this.followed().size > 0);
            // Pictures last, so they draw over the contacts.
            addPhotoLayers(map, this.pictures(), { visible: this.showPhotos(), selectedId: this.selectedPictureId() });
            if (firstStyle) {
              firstStyle = false;
              // Registered in this order so that, where a contact sits on a base, the contact (drawn on top) wins.
              this.basemaps.bindClick(POI_POINTS, (p) => this.selectPoi(Number(p['id'])));
              this.basemaps.bindClick(POINT_LAYER, (p) => this.select(Number(p['id'])));
              // Pictures are drawn on top, so they are registered last and win where they overlap a contact.
              this.basemaps.bindClick(PHOTO_POINTS, (p) => this.selectPicture(Number(p['id'])));
              this.basemaps.bindClick(PHOTO_IMAGES, (p) => this.selectPicture(Number(p['id'])));
              this.basemaps.bindClick(PHOTO_CLUSTERS, (p, at) => void zoomIntoCluster(map, Number(p['cluster_id']), at));
              // A click where none of those is under the pointer is a click on empty map.
              this.basemaps.bindBackgroundClick([POI_POINTS, POINT_LAYER, PHOTO_POINTS, PHOTO_IMAGES, PHOTO_CLUSTERS], () => this.clearMapSelection());
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
  private refreshContacts(afterSearch = false): void {
    const map = this.map;
    if (!map) {
      return;
    }
    const shown = this.visible();
    setContacts(map, shown);
    setHeatField(map, this.heatField(), fieldRange(shown, this.heatField()));
    setTracks(map, this.tracks());
    if (this.fitRequest === (afterSearch ? 'search' : 'now')) {
      this.fitRequest = null;
      if (shown.length > 0) {
        this.basemaps.fitTo(shown, this.mapPadding(), FIT_MAX_ZOOM);
      }
    }
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
    this.refreshContacts(true);
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
          size: this.sizeField(),
          overlays: this.basemaps.overlayIds().join(',') || null,
          incident: this.selectedId(),
          poi: this.selectedPoiId(),
          picture: this.selectedPictureId(),
          person: this.selectedPerson(),
          charts: this.flyout() === 'charts' ? '1' : null,
          roll: this.flyout() === 'roll' ? '1' : null,
          track: null,
          follow: this.followed().size ? [...this.followed()].sort((a, b) => a - b).join(',') : null,
          ...(tree ? toParams(this.filters(), tree) : {}),
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }, 400);
  }
}
