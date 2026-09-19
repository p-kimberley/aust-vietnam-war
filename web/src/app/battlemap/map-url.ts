/**
 * Camera state in the URL, compatible with the legacy map's `?at=<lat>,<lng>,<zoom>` links (which people have
 * shared for years). The legacy zoom was an OpenLayers zoom, which is one level above the Mapbox GL zoom for the
 * same view, so the offset is applied in both directions and old and new links stay interchangeable.
 */
const LEGACY_ZOOM_OFFSET = 1;

export interface Camera {
  lat: number;
  lon: number;
  /** Mapbox GL zoom. */
  zoom: number;
}

const MIN_ZOOM = 0;
const MAX_ZOOM = 22;

export function parseAt(value: string | null | undefined): Camera | null {
  if (!value) {
    return null;
  }
  const parts = value.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) {
    return null;
  }
  const [lat, lon, legacyZoom] = parts;
  const zoom = legacyZoom - LEGACY_ZOOM_OFFSET;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || zoom < MIN_ZOOM || zoom > MAX_ZOOM) {
    return null;
  }
  return { lat, lon, zoom };
}

export function formatAt(camera: Camera): string {
  const round = (n: number, dp: number) => Number(n.toFixed(dp));
  return `${round(camera.lat, 5)},${round(camera.lon, 5)},${round(camera.zoom + LEGACY_ZOOM_OFFSET, 2)}`;
}
