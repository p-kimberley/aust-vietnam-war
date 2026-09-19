import { Injectable, OnDestroy, signal } from '@angular/core';
import type { Map } from 'mapbox-gl';
import type { Point } from 'geojson';
import { MapConfig, OverlayConfig, pickBasemap } from './map-config';
import { Camera } from './map-url';

const DEM_SOURCE = 'avw-dem';
const SKY_LAYER = 'avw-sky';
const OVERLAY_PREFIX = 'avw-overlay-';
const TERRAIN_PITCH = 60;

export interface MapStart {
  basemapId?: string | null;
  camera?: Camera | null;
  terrain?: boolean;
  overlays?: readonly string[];
}

export interface MapHooks {
  /** Runs after every style load (including the first). Custom sources and layers must be re-added here. */
  styleLoaded: (map: Map) => void;
  cameraChanged: (camera: Camera) => void;
  failed: (message: string) => void;
}

/**
 * The single place that talks to Mapbox GL for basemaps, 3D terrain and raster overlays, so a provider swap
 * (for example to MapLibre) touches this file and not the features built on top of it. The catalogue comes from the
 * API's runtime configuration.
 *
 * Provided per map component: one service instance owns one map.
 */
@Injectable()
export class BasemapService implements OnDestroy {
  private mapbox?: typeof import('mapbox-gl').default;
  private map?: Map;
  private config?: MapConfig;

  readonly basemapId = signal<string | undefined>(undefined);
  readonly terrainEnabled = signal(false);
  readonly overlayIds = signal<readonly string[]>([]);

  /** Loads Mapbox GL on demand (it is large and browser-only) and creates the map. */
  async create(container: HTMLElement, config: MapConfig, start: MapStart, hooks: MapHooks): Promise<Map> {
    loadStylesheet();
    const { default: mapboxgl } = await import('mapbox-gl');
    this.mapbox = mapboxgl;
    this.config = config;
    mapboxgl.accessToken = config.mapboxToken ?? '';

    const basemap = pickBasemap(config, start.basemapId);
    if (!basemap) {
      throw new Error('No basemaps are configured.');
    }
    this.basemapId.set(basemap.id);
    this.terrainEnabled.set(!!start.terrain && !!config.terrain);
    this.overlayIds.set((start.overlays ?? []).filter((id) => config.overlays.some((o) => o.id === id)));

    const camera = start.camera ?? { lat: config.center[1], lon: config.center[0], zoom: config.zoom };
    const map = new mapboxgl.Map({
      container,
      style: basemap.style,
      center: [camera.lon, camera.lat],
      zoom: camera.zoom,
      pitch: this.terrainEnabled() ? TERRAIN_PITCH : 0,
      hash: false,
      attributionControl: true,
    });
    this.map = map;

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');

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
      const status = (e.error as { status?: number } | undefined)?.status;
      if (status === 401 || status === 403) {
        hooks.failed('Mapbox rejected the access token. Check map.mapboxToken and its URL restrictions.');
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
    this.map.setStyle(basemap.style);
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

  /** Shows `build(properties)` in a popup when a feature on `layerId` is clicked. Survives style changes. */
  bindPopup(layerId: string, build: (properties: Record<string, unknown>) => HTMLElement): void {
    const { map, mapbox } = this;
    if (!map || !mapbox) {
      return;
    }
    map.on('click', layerId, (e) => {
      const feature = e.features?.[0];
      if (!feature?.properties) {
        return;
      }
      new mapbox.Popup({ maxWidth: '260px' })
        .setLngLat((feature.geometry as Point).coordinates as [number, number])
        .setDOMContent(build(feature.properties))
        .addTo(map);
    });
    map.on('mouseenter', layerId, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layerId, () => (map.getCanvas().style.cursor = ''));
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = undefined;
  }

  private applyTerrain(map: Map): void {
    const terrain = this.config?.terrain;
    if (!terrain) {
      return;
    }
    if (this.terrainEnabled()) {
      if (!map.getSource(DEM_SOURCE)) {
        map.addSource(DEM_SOURCE, { type: 'raster-dem', url: terrain.source, tileSize: 512, maxzoom: 14 });
      }
      map.setTerrain({ source: DEM_SOURCE, exaggeration: terrain.exaggeration });
      if (!map.getLayer(SKY_LAYER)) {
        map.addLayer({
          id: SKY_LAYER,
          type: 'sky',
          paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0, 0], 'sky-atmosphere-sun-intensity': 12 },
        });
      }
    } else {
      // Terrain must be detached before its source can be removed.
      map.setTerrain(null);
      if (map.getLayer(SKY_LAYER)) map.removeLayer(SKY_LAYER);
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
    map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': overlay.opacity } }, firstSymbol);
  }
}

/** Mapbox GL's stylesheet is copied to /vendor by angular.json and loaded only on this route, not on every page. */
function loadStylesheet(): void {
  if (document.querySelector('link[data-mapbox-gl]')) {
    return;
  }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/vendor/mapbox-gl.css';
  link.dataset['mapboxGl'] = '';
  document.head.append(link);
}
