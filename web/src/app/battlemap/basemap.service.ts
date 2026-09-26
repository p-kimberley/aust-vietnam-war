import { Injectable, OnDestroy, signal } from '@angular/core';
import type { Map } from 'maplibre-gl';
import { MapConfig, OverlayConfig, basemapStyle, pickBasemap } from './map-config';
import { Camera } from './map-url';

const DEM_SOURCE = 'avw-dem';
const OVERLAY_PREFIX = 'avw-overlay-';
const TERRAIN_PITCH = 60;
const WORKER_URL = '/vendor/maplibre-gl-worker.mjs';
const FIT_DURATION_MS = 900;

export interface MapStart {
  basemapId?: string | null;
  camera?: Camera | null;
  terrain?: boolean;
  overlays?: readonly string[];
  /** Opacity chosen for an overlay before the map exists (from a link); an overlay not here starts at its configured default. */
  overlayOpacities?: ReadonlyMap<string, number>;
}

/** The inverse of how {@link BasemapService.overlayOpacity} choices are put in a link: `id:value` pairs, comma-separated. */
export function parseOverlayOpacities(value: string | null | undefined): ReadonlyMap<string, number> {
  const out = new globalThis.Map<string, number>();
  for (const token of (value ?? '').split(',')) {
    const [id, raw] = token.split(':');
    const n = Number(raw);
    if (id && Number.isFinite(n) && n >= 0 && n <= 1) {
      out.set(id, n);
    }
  }
  return out;
}

export interface MapHooks {
  /** Runs after every style load (including the first). Custom sources and layers must be re-added here. */
  styleLoaded: (map: Map) => void;
  cameraChanged: (camera: Camera) => void;
  failed: (message: string) => void;
}

/**
 * The single place that talks to the map library for basemaps, 3D terrain and raster overlays, so a library or
 * provider swap touches this file and not the features built on top of it. The catalogue comes from the API's
 * runtime configuration. The library is MapLibre GL (BSD-licensed, no access token, no vendor calls).
 *
 * Provided per map component: one service instance owns one map.
 */
@Injectable()
export class BasemapService implements OnDestroy {
  private map?: Map;
  private lib?: typeof import('maplibre-gl');
  private config?: MapConfig;

  readonly basemapId = signal<string | undefined>(undefined);
  readonly terrainEnabled = signal(false);
  readonly overlayIds = signal<readonly string[]>([]);
  /** Opacity chosen for an overlay, keyed by id; an overlay not here is at its configured default. */
  private readonly overlayOpacities = signal<ReadonlyMap<string, number>>(new globalThis.Map());

  /** Loads MapLibre GL on demand (it is large and browser-only) and creates the map. */
  async create(container: HTMLElement, config: MapConfig, start: MapStart, hooks: MapHooks): Promise<Map> {
    loadStylesheet();
    const maplibre = await import('maplibre-gl');
    // The bundler cannot find the library's web worker (the dev server answers 404 and the map silently loses vector
    // tiles and GeoJSON), so the worker and its shared chunk are copied to /vendor by angular.json and loaded from there.
    maplibre.setWorkerUrl(WORKER_URL);
    this.lib = maplibre;
    this.config = config;

    const basemap = pickBasemap(config, start.basemapId);
    if (!basemap) {
      throw new Error('No basemaps are configured.');
    }
    this.basemapId.set(basemap.id);
    this.terrainEnabled.set(!!start.terrain && !!config.terrain);
    this.overlayIds.set((start.overlays ?? []).filter((id) => config.overlays.some((o) => o.id === id)));
    this.overlayOpacities.set(start.overlayOpacities ?? new globalThis.Map());

    const camera = start.camera ?? { lat: config.center[1], lon: config.center[0], zoom: config.zoom };
    const map = new maplibre.Map({
      container,
      style: basemapStyle(basemap),
      center: [camera.lon, camera.lat],
      zoom: camera.zoom,
      pitch: this.terrainEnabled() ? TERRAIN_PITCH : 0,
      // No credits line on the map (the owner's choice, 2026-09-26; see R.31 in the assumptions log). The sources still
      // carry their attribution, so turning it back on is one AttributionControl added below.
      attributionControl: false,
    });
    this.map = map;

    // MapLibre puts each newly added control at the front of its corner, so these are added in the reverse of the
    // order they should read in: navigation (which ends in the tilt control) first, then the scale. battlemap.css turns
    // the corner into a single row so the scale sits beside the tilt control rather than stacked under it.
    map.addControl(new maplibre.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'bottom-left');

    // A style load replaces the whole style, so terrain, overlays and data layers are put back each time.
    map.on('style.load', () => {
      this.applyTerrain(map);
      this.applyOverlays(map);
      hooks.styleLoaded(map);
    });
    map.on('moveend', () => {
      const c = map.getCenter();
      hooks.cameraChanged({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
    });
    map.on('error', (e) => {
      const error = e.error as { message?: string; status?: number; url?: string } | undefined;
      // A style that cannot be fetched leaves a blank map, so say so. Individual tile failures are routine.
      if (error?.url && error.url === this.currentStyleUrl() && error.status !== undefined) {
        hooks.failed(`The basemap style could not be loaded (${error.status}). Check the map catalogue in the API configuration.`);
      } else {
        console.warn('Map error:', error?.message ?? e.error);
      }
    });

    return map;
  }

  setBasemap(id: string): void {
    const basemap = this.config?.basemaps.find((b) => b.id === id);
    if (!this.map || !basemap || id === this.basemapId()) {
      return;
    }
    this.basemapId.set(id);
    this.map.setStyle(basemapStyle(basemap));
  }

  setTerrain(enabled: boolean): void {
    const map = this.map;
    if (!map || !this.config?.terrain) {
      return;
    }
    this.terrainEnabled.set(enabled);
    this.applyTerrain(map);
    map.easeTo({ pitch: enabled ? TERRAIN_PITCH : 0, duration: 800 });
  }

  setOverlay(id: string, enabled: boolean): void {
    const map = this.map;
    if (!map || !this.config?.overlays.some((o) => o.id === id)) {
      return;
    }
    const next = new Set(this.overlayIds());
    if (enabled) next.add(id);
    else next.delete(id);
    this.overlayIds.set([...next]);
    this.applyOverlays(map);
  }

  /** The opacity an overlay shows at now: what the reader chose, or its configured default (fully opaque unless set otherwise). */
  overlayOpacity(id: string): number {
    return this.overlayOpacities().get(id) ?? this.config?.overlays.find((o) => o.id === id)?.opacity ?? 1;
  }

  /** Fades an overlay in or out, from fully transparent (0) to fully opaque (1); takes effect at once if it is showing. */
  setOverlayOpacity(id: string, opacity: number): void {
    this.overlayOpacities.update((m) => new globalThis.Map(m).set(id, opacity));
    const map = this.map;
    const layerId = OVERLAY_PREFIX + id;
    if (map?.getLayer(layerId)) {
      map.setPaintProperty(layerId, 'raster-opacity', opacity);
    }
  }

  /** Calls `handler` with a feature's properties, and where it was clicked, when it is clicked on `layerId`. Survives style changes. */
  bindClick(layerId: string, handler: (properties: Record<string, unknown>, at: { lon: number; lat: number }) => void): void {
    const map = this.map;
    if (!map) {
      return;
    }
    map.on('click', layerId, (e) => {
      const properties = e.features?.[0]?.properties;
      if (properties) {
        handler(properties, { lon: e.lngLat.lng, lat: e.lngLat.lat });
      }
    });
    map.on('mouseenter', layerId, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layerId, () => (map.getCanvas().style.cursor = ''));
  }

  /**
   * Shows a small tooltip by a feature on `layerId` while the pointer is over it, holding what `content` makes of the feature
   * (none when it gives `null`). Pointer only: a tap is a click, and opens the feature instead. Survives style changes.
   */
  bindHover(layerId: string, content: (properties: Record<string, unknown>) => HTMLElement | null): void {
    const map = this.map;
    if (!map || !this.lib) {
      return;
    }
    const popup = new this.lib.Popup({ closeButton: false, closeOnClick: false, className: 'map-tip', offset: 10, maxWidth: '18rem' });
    let shown: unknown;
    const hide = () => {
      popup.remove();
      shown = undefined;
    };
    map.on('mousemove', layerId, (e) => {
      const feature = e.features?.[0];
      if (!feature) {
        return hide();
      }
      if (feature.id !== shown) {
        const el = content(feature.properties);
        if (!el) {
          return hide();
        }
        shown = feature.id;
        const at = feature.geometry.type === 'Point' ? (feature.geometry.coordinates as [number, number]) : e.lngLat;
        popup.setDOMContent(el).setLngLat(at).addTo(map);
      }
    });
    map.on('mouseleave', layerId, hide);
  }

  /** Calls `handler` when the map is clicked where nothing on any of `layers` is under the pointer. */
  bindBackgroundClick(layers: readonly string[], handler: () => void): void {
    const map = this.map;
    if (!map) {
      return;
    }
    map.on('click', (e) => {
      const present = layers.filter((id) => map.getLayer(id));
      if (present.length === 0 || map.queryRenderedFeatures(e.point, { layers: present }).length === 0) {
        handler();
      }
    });
  }

  /**
   * Eases the camera so that every point is in view, inside `padding` (the room the panels and the timeline take), and no
   * closer than `maxZoom`, so a single point does not zoom to the rooftops.
   */
  fitTo(points: readonly { lat: number; lon: number }[], padding: { top: number; bottom: number; left: number; right: number }, maxZoom: number): void {
    const map = this.map;
    if (!map || points.length === 0) {
      return;
    }
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const p of points) {
      west = Math.min(west, p.lon);
      east = Math.max(east, p.lon);
      south = Math.min(south, p.lat);
      north = Math.max(north, p.lat);
    }
    map.fitBounds([[west, south], [east, north]], { padding, maxZoom, duration: FIT_DURATION_MS });
  }

  /**
   * Eases the camera to a point, zooming in if the view is currently wider than `minZoom`. With `padding` (what the panels and
   * timeline cover at each side), the point lands in the middle of the map that can be seen rather than of the whole map. It is
   * an offset for this move only: the library's own padding would stay with the map and move every later centre.
   */
  flyTo(lat: number, lon: number, minZoom: number, padding?: { top: number; bottom: number; left: number; right: number }): void {
    const map = this.map;
    if (map) {
      const offset: [number, number] = padding ? [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2] : [0, 0];
      map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), minZoom), offset, duration: 800 });
    }
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = undefined;
  }

  /** `undefined` for a basemap built from raw tiles: it has no style URL that could itself fail to load. */
  private currentStyleUrl(): string | undefined {
    return this.config?.basemaps.find((b) => b.id === this.basemapId())?.style || undefined;
  }

  private applyTerrain(map: Map): void {
    const terrain = this.config?.terrain;
    if (!terrain) {
      return;
    }
    if (this.terrainEnabled()) {
      if (!map.getSource(DEM_SOURCE)) {
        map.addSource(DEM_SOURCE, {
          type: 'raster-dem',
          ...(terrain.url ? { url: terrain.url } : { tiles: terrain.tiles }),
          encoding: terrain.encoding,
          tileSize: terrain.tileSize,
          maxzoom: terrain.maxZoom,
          attribution: terrain.attribution ?? undefined,
        });
      }
      map.setTerrain({ source: DEM_SOURCE, exaggeration: terrain.exaggeration });
      // Colours from the style guide (khaki haze at the horizon); only visible once the view is pitched.
      map.setSky({
        'sky-color': '#9dbad0',
        'horizon-color': '#e6ddb8',
        'fog-color': '#e6ddb8',
        'sky-horizon-blend': 0.6,
        'horizon-fog-blend': 0.6,
        'fog-ground-blend': 0.4,
      });
    } else {
      // Terrain must be detached before its source can be removed.
      map.setTerrain(null);
      if (map.getSource(DEM_SOURCE)) map.removeSource(DEM_SOURCE);
    }
  }

  private applyOverlays(map: Map): void {
    const wanted = new Set(this.overlayIds());
    for (const overlay of this.config?.overlays ?? []) {
      const id = OVERLAY_PREFIX + overlay.id;
      if (wanted.has(overlay.id) && !map.getSource(id)) {
        this.addOverlay(map, id, overlay);
      } else if (!wanted.has(overlay.id) && map.getSource(id)) {
        if (map.getLayer(id)) map.removeLayer(id);
        map.removeSource(id);
      }
    }
  }

  private addOverlay(map: Map, id: string, overlay: OverlayConfig): void {
    map.addSource(id, {
      type: 'raster',
      tiles: overlay.tiles,
      tileSize: overlay.tileSize,
      attribution: overlay.attribution ?? undefined,
    });
    // Beneath the first symbol layer so place labels stay readable over the raster.
    const firstSymbol = map.getStyle()?.layers.find((l) => l.type === 'symbol')?.id;
    map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': this.overlayOpacity(overlay.id) } }, firstSymbol);
  }
}

/** The library's stylesheet is copied to /vendor by angular.json and loaded only on this route, not on every page. */
function loadStylesheet(): void {
  if (document.querySelector('link[data-maplibre-gl]')) {
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/vendor/maplibre-gl.css';
  link.dataset['maplibreGl'] = '';
  document.head.append(link);
}
