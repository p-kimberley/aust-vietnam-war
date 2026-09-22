import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { StyleSpecification } from 'maplibre-gl';

/** Mirrors `GET /api/map/config`: the basemap, overlay and terrain catalogue is deployment configuration. */
export interface MapConfig {
  /** `[lon, lat]`. */
  center: [number, number];
  zoom: number;
  basemaps: BasemapConfig[];
  overlays: OverlayConfig[];
  terrain: TerrainConfig | null;
}

export interface BasemapConfig {
  id: string;
  name: string;
  /** An absolute http(s) URL of a MapLibre-compatible style (validated by the API at startup). Empty for plain raster tiles; see `tiles`. */
  style: string;
  /** XYZ raster tile templates for a basemap with no style of its own (for example satellite imagery). Empty when `style` is set. */
  tiles: string[];
  tileSize: number;
  attribution: string | null;
  default: boolean;
}

export interface OverlayConfig {
  id: string;
  name: string;
  tiles: string[];
  tileSize: number;
  attribution: string | null;
  opacity: number;
}

/** An elevation (raster-dem) source: a TileJSON `url` or explicit `tiles`, plus how the PNGs encode height. */
export interface TerrainConfig {
  url: string | null;
  tiles: string[];
  encoding: 'terrarium' | 'mapbox';
  tileSize: number;
  maxZoom: number;
  exaggeration: number;
  attribution: string | null;
}

@Injectable({ providedIn: 'root' })
export class MapConfigService {
  private readonly http = inject(HttpClient);
  private inflight?: Promise<MapConfig>;

  /** Loaded once per page; a failed load is not cached so the map can retry. */
  load(): Promise<MapConfig> {
    this.inflight ??= firstValueFrom(this.http.get<MapConfig>('/api/map/config')).catch((e) => {
      this.inflight = undefined;
      throw e;
    });
    return this.inflight;
  }
}

/** The basemap to show: the requested one if it exists, else the configured default, else the first. */
export function pickBasemap(config: MapConfig, requestedId?: string | null): BasemapConfig | undefined {
  return (
    config.basemaps.find((b) => b.id === requestedId) ?? config.basemaps.find((b) => b.default) ?? config.basemaps[0]
  );
}

/** What to give the map library: the basemap's own style, or, for one with no style, a minimal style built from its raster tiles. */
export function basemapStyle(basemap: BasemapConfig): string | StyleSpecification {
  if (basemap.style) {
    return basemap.style;
  }
  return {
    version: 8,
    sources: {
      basemap: { type: 'raster', tiles: basemap.tiles, tileSize: basemap.tileSize, attribution: basemap.attribution ?? undefined },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  };
}
