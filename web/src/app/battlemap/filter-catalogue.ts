import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Mirrors `GET /api/contacts/filters`: what the filter panel needs to describe the data. */
export interface FilterCatalogue {
  /** `yyyy-MM-dd`. */
  dateMin: string;
  dateMax: string;
  fr: RangeInfo;
  frCas: RangeInfo;
  en: RangeInfo;
  enCas: RangeInfo;
  /** Names in the order that a contact's 1-based `series` indexes. */
  series: NamedCount[];
  operations: NamedCount[];
  tasks: NamedCount[];
  /** Depth-first, siblings in natural order. Negative ids are synthetic groups. */
  units: UnitNode[];
}

export interface RangeInfo {
  min: number;
  max: number;
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface UnitNode {
  id: number;
  parent: number | null;
  /** Short label such as `D Coy`. */
  label: string;
  /** Full name, for a tooltip. */
  name: string;
  /** A grouping node for a parent unit that is not itself recorded on any contact. */
  synthetic: boolean;
}

@Injectable({ providedIn: 'root' })
export class FilterCatalogueService {
  private readonly http = inject(HttpClient);
  private inflight?: Promise<FilterCatalogue>;

  /** Loaded once per page; a failed load is not cached so it can be retried. */
  load(): Promise<FilterCatalogue> {
    this.inflight ??= firstValueFrom(this.http.get<FilterCatalogue>('/api/contacts/filters')).catch((e) => {
      this.inflight = undefined;
      throw e;
    });
    return this.inflight;
  }

  /** Ids of the contacts whose incident report contains every word of `text`. */
  async search(text: string): Promise<number[]> {
    const params = new HttpParams().set('q', text);
    const result = await firstValueFrom(this.http.get<{ ids: number[] }>('/api/contacts/search', { params }));
    return result.ids;
  }
}
