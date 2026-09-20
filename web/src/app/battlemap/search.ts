import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HonourSummary } from './community/community';
import { Poi, poiLabel } from './poi';

/** A piece of a search excerpt; `match` marks the words that were searched for. */
export interface SnippetPart {
  text: string;
  match: boolean;
}

/** A contact that matched a search, from `GET /api/contacts/find`. */
export interface ContactHit {
  id: number;
  dtg: string;
  snippet: SnippetPart[];
}

export interface FindResult {
  hits: ContactHit[];
  /** How many contacts matched in all; only the best few are in `hits`. */
  total: number;
}

/** A note that matched, from `GET /api/community-search`. `snippet` marks the words that were searched for. */
export interface NoteHit {
  id: number;
  contactId: number;
  title: string;
  snippet: SnippetPart[];
  authorName: string;
  createdUtc: string;
}

/** A picture that matched, by its caption or credit. */
export interface PictureHit {
  id: number;
  contactId: number | null;
  thumbUrl: string;
  caption: string | null;
  credit: string | null;
  lat: number | null;
  lon: number | null;
}

export interface CommunitySearchResult {
  notes: NoteHit[];
  noteTotal: number;
  pictures: PictureHit[];
  pictureTotal: number;
}

/** Search text shorter than this is not sent: one letter matches nearly everything. */
export const MIN_SEARCH_LENGTH = 2;

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly http = inject(HttpClient);

  /** The best contacts for the words in `text`, most relevant first. */
  find(text: string, limit = 8): Promise<FindResult> {
    const params = new HttpParams().set('q', text).set('limit', limit);
    return firstValueFrom(this.http.get<FindResult>('/api/contacts/find', { params }));
  }

  /** Notes and pictures (approved ones only) whose words match every word of `text`. */
  community(text: string, limit = 4): Promise<CommunitySearchResult> {
    const params = new HttpParams().set('q', text).set('limit', limit);
    return firstValueFrom(this.http.get<CommunitySearchResult>('/api/community-search', { params }));
  }

  /** The best few people on the honour roll whose name or service number matches every word of `text`. */
  async people(text: string, limit = 5): Promise<{ items: HonourSummary[]; total: number }> {
    const params = new HttpParams().set('q', text).set('pageSize', limit);
    const page = await firstValueFrom(this.http.get<{ items: HonourSummary[]; total: number }>('/api/honour-roll', { params }));
    return { items: page.items, total: page.total };
  }
}

/**
 * The points of interest whose label contains every word of `query`, best first: a name that starts with the text
 * comes before one that only contains it. Matched locally, since there are only about a hundred.
 */
export function matchPois(pois: readonly Poi[], query: string, limit = 5): Poi[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const scored: { poi: Poi; rank: number }[] = [];
  for (const poi of pois) {
    const label = poiLabel(poi).toLowerCase();
    const name = poi.name.toLowerCase();
    if (words.every((w) => label.includes(w))) {
      scored.push({ poi, rank: name.startsWith(words[0]) ? 0 : label.startsWith(words[0]) ? 1 : 2 });
    }
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.poi.name.localeCompare(b.poi.name))
    .slice(0, limit)
    .map((s) => s.poi);
}
