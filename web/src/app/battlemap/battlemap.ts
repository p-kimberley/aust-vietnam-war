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
import { Router, RouterLink } from '@angular/router';
import type { Map } from 'mapbox-gl';
import { BasemapService } from './basemap.service';
import {
  HEAT_LAYER,
  POINT_LAYER,
  addContactLayers,
  contactSummaryElement,
  setContactVisibility,
  setHeatField,
} from './contact-layers';
import { Contact, ContactProperties, DEFAULT_HEAT_FIELD, HEAT_FIELDS, HeatField, fieldRange, isHeatField } from './contacts';
import { ContactsService } from './contacts.service';
import { MapConfig, MapConfigService, needsMapboxToken } from './map-config';
import { Camera, formatAt, parseAt } from './map-url';

type Status = 'loading' | 'ready' | 'error';

/**
 * The Battle Map (client-only route). Loads the runtime map catalogue and every contact, then draws a heatmap and
 * incident markers on a Mapbox GL map. The view is kept in the URL (`?at=`, `?basemap=`, `?terrain=`, `?field=`,
 * `?overlays=`) so a link reproduces what the sender was looking at.
 */
@Component({
  selector: 'app-battlemap',
  imports: [RouterLink],
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

  private readonly router = inject(Router);
  private readonly configService = inject(MapConfigService);
  private readonly contactsService = inject(ContactsService);
  protected readonly basemaps = inject(BasemapService);
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');

  private map?: Map;
  private contacts: Contact[] = [];
  private urlTimer?: ReturnType<typeof setTimeout>;

  protected readonly status = signal<Status>('loading');
  protected readonly message = signal('');
  protected readonly config = signal<MapConfig | null>(null);
  protected readonly contactCount = signal(0);
  protected readonly panelOpen = signal(true);
  protected readonly showHeatmap = signal(true);
  protected readonly showMarkers = signal(true);
  protected readonly heatField = signal<HeatField>(DEFAULT_HEAT_FIELD);
  protected readonly heatFields = HEAT_FIELDS;
  protected readonly canTerrain = computed(() => !!this.config()?.terrain);

  constructor() {
    afterNextRender(() => void this.start());
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
    if (this.map) setHeatField(this.map, value, fieldRange(this.contacts, value));
    this.syncUrl();
  }

  private async start(): Promise<void> {
    try {
      const [config, contacts] = await Promise.all([this.configService.load(), this.contactsService.load()]);
      this.config.set(config);
      this.contacts = contacts;
      this.contactCount.set(contacts.length);

      if (needsMapboxToken(config) && !config.mapboxToken) {
        this.fail('The map needs a Mapbox access token. Set map.mapboxToken in the API configuration.');
        return;
      }

      const field = this.field();
      if (field && isHeatField(field)) {
        this.heatField.set(field);
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
            addContactLayers(map, this.contacts, this.heatField(), fieldRange(this.contacts, this.heatField()), {
              heatmap: this.showHeatmap(),
              markers: this.showMarkers(),
            });
            if (firstStyle) {
              firstStyle = false;
              this.basemaps.bindPopup(POINT_LAYER, (p) => contactSummaryElement(p as unknown as ContactProperties));
              this.status.set('ready');
            }
          },
          cameraChanged: () => this.syncUrl(),
          failed: (message) => this.fail(message),
        },
      );
    } catch (e) {
      console.error('Battle Map failed to start', e);
      this.fail('The Battle Map could not be loaded. Please try again shortly.');
    }
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
      void this.router.navigate([], {
        queryParams: {
          at: formatAt(camera),
          basemap: basemapId && basemapId !== defaultBasemap ? basemapId : null,
          terrain: this.basemaps.terrainEnabled() ? '1' : null,
          field: this.heatField() !== DEFAULT_HEAT_FIELD ? this.heatField() : null,
          overlays: this.basemaps.overlayIds().join(',') || null,
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }, 400);
  }
}
