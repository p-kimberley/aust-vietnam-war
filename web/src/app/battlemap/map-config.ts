import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Mirrors `GET /api/map/config`: the basemap, overlay and terrain catalogue is deployment configuration. */
export interface MapConfig {
  mapboxToken: string | null;
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
  /** A style URL: `mapbox://styles/...` or https. */
  style: string;
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

export interface TerrainConfig {
  source: string;
  exaggeration: number;
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

/** True when a Mapbox-hosted style or terrain source is configured, which makes a token mandatory. */
export function needsMapboxToken(config: MapConfig): boolean {
  return (
    config.basemaps.some((b) => b.style.startsWith('mapbox://')) || (config.terrain?.source.startsWith('mapbox://') ?? false)
  );
}
