import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Mirrors `GET /api/pois`: what the map draws for a point of interest. */
export interface Poi {
  id: number;
  /** Short code: `FSB`, `FSPB`, `LZ`, `Base` or `Other`. */
  type: string;
  name: string;
  established: number | null;
  lat: number;
  lon: number;
}

/** Mirrors `GET /api/pois/{id}`. */
export interface PoiDetail extends Poi {
  /** Plain-text history. */
  details: string | null;
}

const TYPE_NAMES: Record<string, string> = {
  FSB: 'Fire Support Base',
  FSPB: 'Fire Support Patrol Base',
  LZ: 'Landing Zone',
  Base: 'Base',
  Other: 'Other',
};

/** The full name of a type code, falling back to the code itself. */
export function typeName(type: string): string {
  return TYPE_NAMES[type] ?? type;
}

/** The short label drawn on the map, for example `FSB Le Loi`. */
export function poiLabel(poi: Pick<Poi, 'type' | 'name'>): string {
  return `${poi.type} ${poi.name}`.trim();
}

@Injectable({ providedIn: 'root' })
export class PoiService {
  private readonly http = inject(HttpClient);
  private inflight?: Promise<Poi[]>;
  private readonly details = new Map<number, Promise<PoiDetail | null>>();

  /** Every visible point of interest, loaded once. A failed load is not cached. */
  list(): Promise<Poi[]> {
    this.inflight ??= firstValueFrom(this.http.get<Poi[]>('/api/pois')).catch((e) => {
      this.inflight = undefined;
      throw e;
    });
    return this.inflight;
  }

  /** One point in full, or `null` when it does not exist. */
  detail(id: number): Promise<PoiDetail | null> {
    let pending = this.details.get(id);
    if (!pending) {
      pending = firstValueFrom(this.http.get<PoiDetail>(`/api/pois/${id}`)).catch((e) => {
        if (e instanceof HttpErrorResponse && e.status === 404) {
          return null;
        }
        this.details.delete(id);
        throw e;
      });
      this.details.set(id, pending);
    }
    return pending;
  }
}
