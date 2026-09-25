import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { AnalyticsPanel } from './analytics/analytics-panel';
import { DateRange, Timeline, TimelineFocus } from './analytics/timeline';
import { BasemapPicker } from './basemap-picker';
import { FollowPanel } from './follow-panel';
import { LayerRow } from './layer-row';
import { LeftTab, LeftTabs } from './left-tabs';
import { MapLegend } from './map-legend';
import { NominalRoll } from './nominal-roll';
import { BasemapService, parseOverlayOpacities } from './basemap.service';
import { IncidentPanel } from './incident-panel';
import { Poi, PoiService } from './poi';
import { POI_POINTS, addPoiLayers, setPoiVisibility } from './poi-layers';
import { CommunityService, IncidentMediaView, PictureRef } from './community/community';
import { HonourPanel } from './community/honour-panel';
import {
  PHOTO_CLUSTERS,
  PHOTO_IMAGES,
  PHOTO_POINTS,
  PHOTO_FULL_ZOOM,
  addPhotoLayers,
  clusterPictures,
  refreshStacks,
  setPhotoVisibility,
  setPhotos,
  zoomIntoCluster,
} from './photo-layers';
import { PhotoSpider, SPIDER_IMAGES, isStack } from './photo-spider';
import { STACK_BADGES, STACK_COUNTS, stackIds } from './photo-stacks';
import { PicturePlacementService } from './picture-placement.service';
import { PictureViewer } from './picture-viewer';
import { PicturesPanel } from './pictures-panel';
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
} from './contact-layers';
import {
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
import { ContactFilteringService } from './contact-filtering.service';
import { ContactsService } from './contacts.service';
import { FilterCatalogueService } from './filter-catalogue';
import { FiltersPanel } from './filters-panel';
import { FilterState, fromParams, hasText, toParams } from './filters';
import { MapConfig, MapConfigService } from './map-config';
import { Camera, formatAt, parseAt } from './map-url';
import { MapSelectionService } from './map-selection.service';
import { MapViewStateService } from './map-view-state.service';
import { FollowRow, Track, addTrackLayers, animateTracks, buildTracks, followedFromLink, neighbour, setTrackVisibility, setTracks } from './track';
import { UnitFollowService } from './unit-follow.service';

type Status = 'loading' | 'ready' | 'error';
type Tab = 'layers' | 'filters';

/** How long the fly-out takes to slide away; its panel is put away when it has gone. */
const FLYOUT_SLIDE_MS = 300;
/** A filter that leaves one contact, or a few close together, zooms no closer than this. */
const FIT_MAX_ZOOM = 13;
/** Air round the fitted contacts, beyond the panels and the timeline, so they do not land flush against an edge. */
const FIT_PADDING_PX = 50;
/** How far round the pointer, in pixels, a click looks for pictures lying on top of each other. */
const STACK_PROBE_PX = 3;

/** The middle of some places: where a stack of pictures springs apart from. */
function centreOf(places: readonly { lon: number; lat: number }[]): { lon: number; lat: number } {
  const n = places.length || 1;
  return { lon: places.reduce((s, p) => s + p.lon, 0) / n, lat: places.reduce((s, p) => s + p.lat, 0) / n };
}

/**
 * The Battle Map (client-only route). Loads the runtime map catalogue, every contact and the filter catalogue, then
 * draws a heatmap and incident markers on a MapLibre GL map. Filters run in the browser over the loaded contacts (the
 * dataset is small); only the incident-report word search goes to the server. The view is kept in the URL (`?at=`,
 * `?basemap=`, `?terrain=`, `?field=`, `?size=`, `?overlays=`, `?opacity=`, `?bases=`, `?photos=`, `?markers=`, `?heatmap=`,
 * `?incident=`, `?poi=`, `?picture=`, the tool open at the left (`?charts=`, `?roll=`, `?images=`) and the filter parameters described in `filters.ts`) so a link reproduces what the
 * sender was looking at; every one of them is left out when it is at its default, so a plain `/battlemap` link stays short.
 */
@Component({
  selector: 'app-battlemap',
  imports: [
    RouterLink,
    BasemapPicker,
    FollowPanel,
    LayerRow,
    LeftTabs,
    MapLegend,
    NominalRoll,
    IncidentPanel,
    PoiPanel,
    PictureViewer,
    PicturesPanel,
    HonourPanel,
    FiltersPanel,
    SearchBox,
    AnalyticsPanel,
    Timeline,
  ],
  providers: [BasemapService, MapSelectionService, MapViewStateService, UnitFollowService, ContactFilteringService, PicturePlacementService],
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
  readonly opacity = input<string>();
  readonly bases = input<string>();
  readonly photos = input<string>();
  readonly markers = input<string>();
  readonly heatmap = input<string>();
  readonly incident = input<string>();
  readonly poi = input<string>();
  readonly picture = input<string>();
  readonly charts = input<string>();
  readonly roll = input<string>();
  readonly images = input<string>();
  readonly track = input<string>();
  readonly follow = input<string>();
  readonly person = input<string>();

  private readonly route = inject(ActivatedRoute);
  private readonly configService = inject(MapConfigService);
  private readonly contactsService = inject(ContactsService);
  private readonly filterService = inject(FilterCatalogueService);
  private readonly poiService = inject(PoiService);
  private readonly community = inject(CommunityService);
  protected readonly basemaps = inject(BasemapService);
  /** Which one of an incident, a base, a photo or a person is open at the right; never more than one. */
  protected readonly selection = inject(MapSelectionService);
  private readonly urlState = inject(MapViewStateService);
  protected readonly followUnits = inject(UnitFollowService);
  protected readonly contactFilter = inject(ContactFilteringService);
  private readonly placement = inject(PicturePlacementService);
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  private map?: MapLibreMap;
  /** Spreads out pictures that lie on top of each other, so each can be chosen. */
  private spider?: PhotoSpider;

  protected readonly status = signal<Status>('loading');
  protected readonly message = signal('');
  protected readonly config = signal<MapConfig | null>(null);
  protected readonly pois = signal<readonly Poi[]>([]);
  protected readonly showPois = signal(true);
  /** Community pictures that have a place on the map. */
  protected readonly mapPictures = signal<readonly IncidentMediaView[]>([]);
  protected readonly showPhotos = signal(true);
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
    { id: 'images', label: 'Images' },
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
    const id = this.selection.selectedId();
    const contact = id === null ? undefined : this.contactFilter.allContacts().find((c) => c.id === id);
    if (!contact) {
      return null;
    }
    const operation = contact.op > 0 ? (this.contactFilter.catalogue()?.operations[contact.op - 1]?.name ?? null) : null;
    return { date: contact.dtg, operation };
  });
  /** A panel is open at the right, so what else sits there moves aside. */
  protected readonly rightPanelOpen = this.selection.anyOpen;
  protected readonly canTerrain = computed(() => !!this.config()?.terrain);

  // ---- filters (see ContactFilteringService for the contacts, the catalogue and what the filters leave)
  protected readonly tracks = computed<Track[]>(() => buildTracks(this.contactFilter.visible(), this.followUnits.followed()));
  /** What the incident panel shows beside a followed unit: the colour of its line, and how many incidents it has. */
  protected readonly followInfo = computed(() => new Map(this.tracks().map((t) => [t.key, { colour: t.colour, stops: t.stops.length }])));
  /** One row per followed unit, for the followed-units panel: its name, colour and where the open incident sits in its path. */
  protected readonly followRows = computed<FollowRow[]>(() => {
    const selected = this.selection.selectedId();
    const tree = this.contactFilter.tree();
    return this.tracks().map((t) => {
      const at = t.stops.findIndex((c) => c.id === selected);
      const node = tree?.get(t.key);
      const label = node?.label ?? `Unit ${t.key}`;
      return { unit: t.key, label, fullName: node?.name ?? label, colour: t.colour, at: at < 0 ? null : at + 1, total: t.stops.length };
    });
  });

  constructor() {
    // Told once here, rather than threaded through every call, since it only ever means one thing: bring the map up to date.
    this.contactFilter.onSearched = () => this.refreshContacts(true);
    afterNextRender(() => void this.start());
  }

  /** Opens the incident panel for a contact (or closes it), ringing the marker and keeping the URL in step. */
  protected select(id: number | null): void {
    this.selection.select(id);
    this.syncUrl();
  }

  /** A click on empty map closes whatever the map opened (the incident, the base or the photo), and closes up spread-out pictures. */
  protected clearMapSelection(): void {
    this.spider?.close();
    this.selection.clear();
    this.syncUrl();
  }

  /** Opens the panel for a point of interest (or closes it). One panel is open at a time, so this closes the incident panel. */
  protected selectPoi(id: number | null): void {
    this.selection.selectPoi(id);
    this.syncUrl();
  }

  /** Opens a community picture in the viewer (or closes it), over whatever else is open. */
  protected selectPicture(id: number | null): void {
    this.selection.selectPicture(id);
    this.spider?.setSelected(id);
    this.syncUrl();
  }

  /** The picture viewer's "Open the incident": the viewer closes, and the incident opens beneath it. */
  protected openIncidentFromPicture(contactId: number): void {
    this.selectPicture(null);
    this.openContact(contactId);
  }

  /**
   * A picture was clicked on the map. The dot and the thumbnail are two layers, and both answer one click, so the click is handled
   * once, after both have been told. Where more than one picture lies under the pointer they spring apart so that each can be
   * chosen; otherwise the one picture opens.
   */
  private photoClicked(id: number, at: { lon: number; lat: number } | undefined): void {
    if (this.photoClickQueued) {
      return;
    }
    this.photoClickQueued = true;
    queueMicrotask(() => {
      this.photoClickQueued = false;
      const stack = at ? this.picturesUnder(at) : [];
      if (stack.length > 1 && this.spider) {
        this.spider.spread(centreOf(stack), stack);
      } else {
        this.selectPicture(id);
      }
    });
  }
  private photoClickQueued = false;

  /** A stack's badge was clicked: its pictures spring apart. */
  private stackClicked(ids: unknown): void {
    const wanted = new Set(stackIds(ids));
    const stack = this.mapPictures()
      .filter((p) => wanted.has(p.id))
      .map((p) => ({ id: p.id, lon: p.lon!, lat: p.lat! }));
    if (stack.length > 1) {
      this.spider?.spread(centreOf(stack), stack);
    }
  }

  /** A numbered group of pictures was clicked: pictures that all lie in one spot spring apart; a group spread wider zooms in to break it up. */
  private async clusterClicked(clusterId: number, at: { lon: number; lat: number }): Promise<void> {
    const map = this.map;
    if (!map) {
      return;
    }
    const pictures = await clusterPictures(map, clusterId).catch(() => []);
    if (isStack(pictures) && this.spider) {
      this.spider.spread(centreOf(pictures), pictures, clusterId);
    } else {
      await zoomIntoCluster(map, clusterId, at);
    }
  }

  /** The pictures (dots or thumbnails) drawn under a point on the map, with their places. */
  private picturesUnder(at: { lon: number; lat: number }): { id: number; lon: number; lat: number }[] {
    const ids = new Set(this.featuresAt(at, [PHOTO_POINTS, PHOTO_IMAGES]).map((f) => Number(f.properties?.['id'])));
    return this.mapPictures()
      .filter((p) => ids.has(p.id))
      .map((p) => ({ id: p.id, lon: p.lon!, lat: p.lat! }));
  }

  /** A picture, or a spread-out one, is under the point: a click there is for the picture, not the incident or base beneath it. */
  private pictureAt(
    at: { lon: number; lat: number } | undefined,
    layers: readonly string[] = [PHOTO_POINTS, PHOTO_IMAGES, PHOTO_CLUSTERS, SPIDER_IMAGES, STACK_BADGES],
  ): boolean {
    return !!at && this.featuresAt(at, layers).length > 0;
  }

  private featuresAt(at: { lon: number; lat: number }, layers: readonly string[]): { properties?: Record<string, unknown> | null }[] {
    const map = this.map;
    const present = layers.filter((id) => map?.getLayer(id));
    if (!map || present.length === 0 || typeof map.queryRenderedFeatures !== 'function') {
      return [];
    }
    const p = map.project([at.lon, at.lat]);
    const r = STACK_PROBE_PX;
    return map.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: present });
  }

  /** A picture was added from the pictures panel. One an editor added is public at once, so it goes on the map now. */
  protected pictureAdded(picture: IncidentMediaView): void {
    if (picture.status !== 'Approved' || picture.lat === null || picture.lon === null) {
      return;
    }
    this.mapPictures.update((list) => [picture, ...list.filter((p) => p.id !== picture.id)]);
    if (this.map) {
      this.spider?.close();
      setPhotos(this.map, this.mapPictures());
    }
  }

  /** Opens a person's page on the honour roll (or closes it), in place of whatever else is open. */
  protected openPerson(serviceNumber: string | null): void {
    this.selection.openPerson(serviceNumber);
    this.syncUrl();
  }

  /** Opens the incident chosen from the search results and brings it into view. */
  protected openContact(id: number): void {
    const contact = this.contactFilter.allContacts().find((c) => c.id === id);
    this.select(id);
    if (contact) this.basemaps.flyTo(contact.lat, contact.lon, 13);
  }

  /** Opens the incident a found note is about, on its notes tab. */
  protected openNote(contactId: number): void {
    this.openContact(contactId);
    this.selection.incidentTab.set('notes');
  }

  /** Opens a photo in the viewer (found by search or in the pictures panel, or taken near an incident) and brings its place into view behind it. */
  protected openPictureAt(picture: PictureRef): void {
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
    if (!visible) this.spider?.close();
    if (this.map) setPhotoVisibility(this.map, visible);
    this.syncUrl();
  }

  protected setPoisVisible(visible: boolean): void {
    this.showPois.set(visible);
    if (this.map) setPoiVisibility(this.map, visible);
    this.syncUrl();
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

  protected setOverlayOpacity(id: string, opacity: number): void {
    this.basemaps.setOverlayOpacity(id, opacity);
    this.syncUrl();
  }

  protected setHeatmapVisible(visible: boolean): void {
    this.showHeatmap.set(visible);
    if (this.map) setContactVisibility(this.map, HEAT_LAYER, visible);
    this.syncUrl();
  }

  protected setMarkersVisible(visible: boolean): void {
    this.showMarkers.set(visible);
    if (this.map) setContactVisibility(this.map, POINT_LAYER, visible);
    this.syncUrl();
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
    return { field, cap: field ? sizeCap(this.contactFilter.allContacts(), field) : 0 };
  }

  protected setMarkerSize(value: string): void {
    const field = isSizeField(value) ? value : null;
    this.sizeField.set(field);
    if (this.map) setMarkerSizing(this.map, this.markerSizing());
    this.syncUrl();
  }

  /** Chooses an operation as a filter, or takes it off again; any number can be chosen. */
  protected toggleOperation(name: string): void {
    this.appliedFilterChange(this.contactFilter.toggleOperation(name));
  }

  /** The timeline sets the same date filter as the filter panel does. */
  protected setDateRange(range: DateRange): void {
    this.appliedFilterChange(this.contactFilter.setDateRange(range));
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
    this.followUnits.toggle(unit);
    this.syncFollowedToMap();
  }

  /** The paths on the map show whenever any unit is followed, and only then. */
  private syncFollowedToMap(): void {
    if (this.map) {
      setTracks(this.map, this.tracks());
      setTrackVisibility(this.map, this.followUnits.followed().size > 0);
    }
    this.syncUrl();
  }

  /** Opens the previous or next incident of a followed unit, flying to it. */
  protected stepFollowed(unit: number, direction: 1 | -1): void {
    const track = this.tracks().find((t) => t.key === unit);
    const next = track ? neighbour(track, this.selection.selectedId(), direction) : null;
    if (next) {
      this.openContact(next.id);
    }
  }

  /** Applies a change from the filter panel: redraws the map, starts a report search if the text changed, updates the URL. */
  protected setFilters(next: FilterState): void {
    this.appliedFilterChange(this.contactFilter.setFilters(next));
  }

  /** After the filters change (however they changed): queues the camera to fit what is left, redraws the map, and syncs the URL. */
  private appliedFilterChange(changedText: boolean): void {
    // The reader chose a filter, so once the contacts it leaves are drawn the map zooms to them. A report search answers later, so
    // its zoom waits for the answer. Play moves the window on every few hundred milliseconds, and a camera that followed each
    // step would be dizzying, so it is left where it is.
    if (!this.timelinePlaying()) {
      this.fitRequest = changedText && hasText(this.contactFilter.filters()) ? 'search' : 'now';
    }
    this.refreshContacts();
    this.syncUrl();
  }

  /** What the map is waiting to zoom to: the contacts a filter has left, now or when the report search has answered. */
  private fitRequest: 'now' | 'search' | null = null;

  /**
   * How much of the map the panels and the timeline cover, so that the contacts land in the part that is left, with
   * {@link FIT_PADDING_PX} of air beyond that. The legend does not count: it sits low enough, and is easy enough to look
   * past, that contacts landing behind it are fine.
   */
  private mapPadding(): { top: number; bottom: number; left: number; right: number } {
    const root = this.host.nativeElement.getBoundingClientRect();
    const timeline = this.host.nativeElement.querySelector('.bm__timeline')?.getBoundingClientRect();
    const panels = [...this.host.nativeElement.querySelectorAll('.panel, .bm__incident')].map((e) => e.getBoundingClientRect().left);
    const padding = {
      top: 64 + FIT_PADDING_PX,
      left: 32 + FIT_PADDING_PX,
      bottom: (timeline ? Math.max(root.bottom - timeline.top, 0) : 0) + 24 + FIT_PADDING_PX,
      right: (panels.length ? Math.max(root.right - Math.min(...panels), 0) : 0) + 24 + FIT_PADDING_PX,
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
      this.mapPictures.set(pictures.filter((p) => p.lat !== null && p.lon !== null));
      this.config.set(config);
      this.contactFilter.allContacts.set(contacts);

      if (catalogue) {
        this.contactFilter.catalogue.set(catalogue);
        this.contactFilter.filters.set(fromParams(this.route.snapshot.queryParams, catalogue, this.contactFilter.tree()!));
        if (hasText(this.contactFilter.filters())) {
          await this.contactFilter.searchNow(this.contactFilter.filters().text);
        }
        if (this.contactFilter.activeCount() > 0) {
          this.tab.set('filters');
        }
      }

      // A link may open onto a person on the honour roll, unless it already names an incident or a base.
      if (this.person() && !this.incident() && !this.poi()) {
        this.selection.selectedPerson.set(this.person()!);
      }

      const tool = this.charts() === '1' ? 'charts' : this.roll() === '1' ? 'roll' : this.images() === '1' ? 'images' : null;
      this.flyout.set(tool);
      this.flyoutShown.set(tool);
      this.followUnits.followed.set(followedFromLink(this.follow(), this.track(), this.contactFilter.filters().units));

      const field = this.field();
      if (field && isHeatField(field)) {
        this.heatField.set(field);
      }
      const size = this.size();
      if (size && isSizeField(size)) {
        this.sizeField.set(size);
      }
      this.showPois.set(this.bases() !== '0');
      this.showPhotos.set(this.photos() !== '0');
      this.showMarkers.set(this.markers() !== '0');
      this.showHeatmap.set(this.heatmap() !== '0');

      // A shared link may open straight onto an incident. Ignore ids that are not real contacts.
      const requested = Number(this.incident());
      const opened = Number.isInteger(requested) ? contacts.find((c) => c.id === requested) : undefined;
      if (opened) {
        this.selection.selectedId.set(opened.id);
      }

      // A link may open onto a point of interest instead. Ignore ids that are not real points.
      const requestedPoi = Number(this.poi());
      const openedPoi = !opened && Number.isInteger(requestedPoi) ? pois.find((p) => p.id === requestedPoi) : undefined;
      if (openedPoi) {
        this.selection.selectedPoiId.set(openedPoi.id);
      }

      // A link may open a picture in the viewer, over anything else it names. It need not be on the map: one waiting for approval
      // (linked from the Studio) is shown to its uploader and to editors, and the viewer says so when there is no such picture.
      const requestedPicture = Number(this.picture());
      if (Number.isInteger(requestedPicture) && requestedPicture > 0) {
        this.selection.selectedPictureId.set(requestedPicture);
      }
      const openedPicture = this.mapPictures().find((p) => p.id === requestedPicture);

      const target = opened ?? openedPoi ?? openedPicture;
      const hasOwnView = !!parseAt(this.at());

      let firstStyle = true;
      this.map = await this.basemaps.create(
        this.canvas().nativeElement,
        config,
        {
          basemapId: this.basemap(),
          camera: parseAt(this.at()),
          terrain: this.terrain() === '1',
          overlays: (this.overlays() ?? '').split(',').filter(Boolean),
          overlayOpacities: parseOverlayOpacities(this.opacity()),
        },
        {
          styleLoaded: (map) => {
            const shown = this.contactFilter.visible();
            // Points of interest first, so contacts draw over them.
            addPoiLayers(map, this.pois(), { visible: this.showPois(), selectedId: this.selection.selectedPoiId() });
            addContactLayers(map, shown, this.heatField(), fieldRange(shown, this.heatField()), {
              heatmap: this.showHeatmap(),
              markers: this.showMarkers(),
              selectedId: this.selection.selectedId(),
              sizing: this.markerSizing(),
            });
            addTrackLayers(map, this.tracks(), this.followUnits.followed().size > 0);
            // Pictures last, so they draw over the contacts.
            addPhotoLayers(map, this.mapPictures(), { visible: this.showPhotos(), selectedId: this.selection.selectedPictureId() });
            refreshStacks(map, this.mapPictures());
            // Spread-out pictures over everything, pictures included. A new style starts with none spread.
            this.spider ??= new PhotoSpider(map);
            this.spider.addLayers();
            this.spider.setSelected(this.selection.selectedPictureId());
            if (firstStyle) {
              firstStyle = false;
              // Registered in this order so that, where a contact sits on a base, the contact (drawn on top) wins. A picture is drawn
              // over both, and the viewer opens over the panels without closing them, so where a picture is under the pointer the
              // click is the picture's alone.
              this.basemaps.bindClick(POI_POINTS, (p, at) => this.pictureAt(at) || this.selectPoi(Number(p['id'])));
              this.basemaps.bindClick(POINT_LAYER, (p, at) => this.pictureAt(at) || this.select(Number(p['id'])));
              this.basemaps.bindClick(PHOTO_POINTS, (p, at) => this.pictureAt(at, [STACK_BADGES]) || this.photoClicked(Number(p['id']), at));
              this.basemaps.bindClick(PHOTO_IMAGES, (p, at) => this.pictureAt(at, [STACK_BADGES]) || this.photoClicked(Number(p['id']), at));
              // The badge sits on a thumbnail's corner; a click on it is for the whole stack.
              this.basemaps.bindClick(STACK_BADGES, (p) => this.stackClicked(p['ids']));
              this.basemaps.bindClick(PHOTO_CLUSTERS, (p, at) => void this.clusterClicked(Number(p['cluster_id']), at!));
              this.basemaps.bindClick(SPIDER_IMAGES, (p) => this.selectPicture(Number(p['id'])));
              // A click where none of those is under the pointer is a click on empty map.
              this.basemaps.bindBackgroundClick([POI_POINTS, POINT_LAYER, PHOTO_POINTS, PHOTO_IMAGES, PHOTO_CLUSTERS, SPIDER_IMAGES, STACK_BADGES], () =>
                this.clearMapSelection(),
              );
              // Which pictures hide each other depends on the zoom, so the stack badges are worked out again when it settles.
              map.on('zoomend', () => refreshStacks(map, this.mapPictures()));
              this.status.set('ready');
              // With no explicit view in the link and nothing else to fly to, animate to fit whatever the filters leave.
              // Deferred to after this is rendered: mapPadding reads the panels' real width, and they do not exist (the
              // whole right-hand column is behind an `@if (status() === 'ready')`) until this has been drawn.
              if (!target && !hasOwnView) {
                afterNextRender(
                  () => {
                    const shown = this.contactFilter.visible();
                    if (shown.length > 0) {
                      this.basemaps.fitTo(shown, this.mapPadding(), FIT_MAX_ZOOM);
                    }
                  },
                  { injector: this.injector },
                );
              }
            }
          },
          cameraChanged: () => this.syncUrl(),
          failed: (message) => this.fail(message),
        },
      );
      this.selection.attach(this.map);
      this.placement.attach(this.map);
      // Marches the dashes along whichever units are followed; off again the moment none are, rather than ticking
      // forever in the background.
      const map = this.map!;
      effect(
        (onCleanup) => {
          if (this.followUnits.followed().size > 0) {
            onCleanup(animateTracks(map));
          }
        },
        { injector: this.injector },
      );

      // With no explicit view in the link, bring the incident, base or photo into frame.
      if (target && !hasOwnView) {
        this.basemaps.flyTo(target.lat!, target.lon!, 11);
      } else if (!hasOwnView && this.selection.selectedPictureId() !== null) {
        // A picture that is not on the map yet (one waiting for approval, linked from the Studio): find out where it goes.
        const detail = await this.community.mediaDetail(this.selection.selectedPictureId()!).catch(() => null);
        if (detail?.lat != null && detail.lon != null) {
          this.basemaps.flyTo(detail.lat, detail.lon, PHOTO_FULL_ZOOM);
        }
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
    const shown = this.contactFilter.visible();
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

  private fail(message: string): void {
    this.message.set(message);
    this.status.set('error');
  }

  /** Writes the current view into the query string, without adding history entries or spamming while panning. */
  private syncUrl(): void {
    this.urlState.sync(() => {
      const map = this.map;
      if (!map) {
        return null;
      }
      const c = map.getCenter();
      const camera: Camera = { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
      const basemapId = this.basemaps.basemapId();
      const defaultBasemap = this.config()?.basemaps.find((b) => b.default)?.id;
      const tree = this.contactFilter.tree();
      return {
        at: formatAt(camera),
        basemap: basemapId && basemapId !== defaultBasemap ? basemapId : null,
        terrain: this.basemaps.terrainEnabled() ? '1' : null,
        field: this.heatField() !== DEFAULT_HEAT_FIELD ? this.heatField() : null,
        size: this.sizeField(),
        overlays: this.basemaps.overlayIds().join(',') || null,
        opacity:
          (this.config()?.overlays ?? [])
            .filter((o) => this.basemaps.overlayOpacity(o.id) !== (o.opacity ?? 1))
            .map((o) => `${o.id}:${this.basemaps.overlayOpacity(o.id)}`)
            .join(',') || null,
        bases: this.showPois() ? null : '0',
        photos: this.showPhotos() ? null : '0',
        markers: this.showMarkers() ? null : '0',
        heatmap: this.showHeatmap() ? null : '0',
        incident: this.selection.selectedId(),
        poi: this.selection.selectedPoiId(),
        picture: this.selection.selectedPictureId(),
        person: this.selection.selectedPerson(),
        charts: this.flyout() === 'charts' ? '1' : null,
        roll: this.flyout() === 'roll' ? '1' : null,
        images: this.flyout() === 'images' ? '1' : null,
        track: null,
        follow: this.followUnits.followed().size ? [...this.followUnits.followed()].sort((a, b) => a - b).join(',') : null,
        ...(tree ? toParams(this.contactFilter.filters(), tree) : {}),
      };
    });
  }
}
