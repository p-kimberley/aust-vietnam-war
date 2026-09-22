import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type ModerationStatus = 'Pending' | 'Approved' | 'Rejected';
export type MediaStatus = 'Pending' | 'Approved' | 'Rejected';

export interface CommentView {
  id: number;
  authorName: string;
  body: string;
  createdUtc: string;
  mine: boolean;
  canDelete: boolean;
}

/** A note as the signed-in person sees it: the author and editors see the newest text, everyone else the approved text. */
export interface NoteView {
  id: number;
  contactId: number;
  title: string;
  body: string;
  authorName: string;
  createdUtc: string;
  updatedUtc: string;
  status: ModerationStatus;
  /** The newest version is waiting for approval while an earlier approved one is what the public sees. */
  pendingEdit: boolean;
  mine: boolean;
  canEdit: boolean;
  commentsOpen: boolean;
  comments: CommentView[];
}

export interface NoteInput {
  title: string;
  body: string;
}

export interface VersionView {
  versionNo: number;
  title: string;
  body: string;
  editedByName: string;
  createdUtc: string;
  approved: boolean;
}

export interface IncidentMediaView {
  id: number;
  mediaId: number;
  /** The incident it belongs to. Pictures carried over from the old site may have none and be placed on the map only. */
  contactId: number | null;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  caption: string | null;
  credit: string | null;
  dateTaken: string | null;
  lat: number | null;
  lon: number | null;
  status: MediaStatus;
  likes: number;
  likedByMe: boolean;
  mine: boolean;
  canRemove: boolean;
  /** Recorded when the picture was uploaded. Who added it is sent only with a picture's own page, not in lists. */
  byteSize: number;
  contentType: string;
  addedUtc: string;
  addedBy: string | null;
}

/** A picture taken near an incident (not one of its own), from `GET /api/contacts/{id}/nearby-media`. */
export interface NearbyPicture {
  id: number;
  contactId: number | null;
  thumbUrl: string;
  caption: string | null;
  credit: string | null;
  lat: number;
  lon: number;
  distanceMetres: number;
}

export interface LikeResult {
  likes: number;
  liked: boolean;
}

export interface HonourSummary {
  serviceNumber: string;
  name: string;
  rank: string | null;
  branch: string | null;
  birth: string | null;
  death: string | null;
  ageAtDeath: number | null;
  portraitUrl: string | null;
  /** How a roll writes the name: "White, James Mungo". */
  sortName?: string | null;
}

export interface HonourTour {
  unit: string | null;
  start: string | null;
  end: string | null;
}

export interface HonourPerson extends HonourSummary {
  birthPlace: string | null;
  birthState: string | null;
  birthCountry: string | null;
  nationalService: boolean | null;
  tours: HonourTour[];
  incidents: number[];
  tributes: number;
}

/** What to restrict the roll to; a blank or missing value is no restriction. */
export interface HonourFilters {
  service?: string;
  rank?: string;
  corps?: string;
}

/** One choice in a drop-down, and how many people it would leave. */
export interface HonourFacetOption {
  value: string;
  count: number;
}

/** The choices for each drop-down, each counted with the search and the other two choices but not its own. */
export interface HonourFacets {
  services: HonourFacetOption[];
  ranks: HonourFacetOption[];
  corps: HonourFacetOption[];
}

export interface HonourPage {
  items: HonourSummary[];
  total: number;
  page: number;
  pageSize: number;
  /** Present only when asked for. */
  facets?: HonourFacets | null;
}

export interface TributeView {
  id: number;
  authorName: string;
  message: string;
  createdUtc: string;
  mine: boolean;
  canDelete: boolean;
}

export interface TributePage {
  items: TributeView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CasualtyInput {
  serviceNumber: string | null;
  casualtyType: string;
  comment: string;
}

export interface CasualtyRow {
  id: number;
  contactId: number;
  serviceNumber: string | null;
  casualtyType: string;
  comment: string;
  submittedByName: string;
  createdUtc: string;
  handled: boolean;
}

export interface PendingNote {
  id: number;
  contactId: number;
  title: string;
  body: string;
  authorName: string;
  updatedUtc: string;
  isChange: boolean;
}

export interface PendingPicture {
  incidentMediaId: number;
  mediaId: number;
  contactId: number | null;
  url: string;
  thumbUrl: string;
  caption: string | null;
  credit: string | null;
  uploadedByName: string;
}

export interface ModerationQueue {
  notes: PendingNote[];
  pictures: PendingPicture[];
  casualties: CasualtyRow[];
}

/** What can happen to a casualty in an incident, as the API accepts it. */
export const CASUALTY_TYPES = ['Killed in action', 'Died of wounds', 'Wounded in action', 'Missing', 'Other'] as const;

/** Typed calls to the community API. Anyone may read; writing needs a signed-in member, which the server checks again. */
@Injectable({ providedIn: 'root' })
export class CommunityService {
  private readonly http = inject(HttpClient);

  // ---- notes
  notes(contactId: number): Promise<NoteView[]> {
    return firstValueFrom(this.http.get<NoteView[]>(`/api/contacts/${contactId}/notes`));
  }

  createNote(contactId: number, input: NoteInput): Promise<NoteView> {
    return firstValueFrom(this.http.post<NoteView>(`/api/contacts/${contactId}/notes`, input));
  }

  updateNote(id: number, input: NoteInput): Promise<NoteView> {
    return firstValueFrom(this.http.put<NoteView>(`/api/notes/${id}`, input));
  }

  deleteNote(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/notes/${id}`));
  }

  noteVersions(id: number): Promise<VersionView[]> {
    return firstValueFrom(this.http.get<VersionView[]>(`/api/notes/${id}/versions`));
  }

  moderateNote(id: number, status: ModerationStatus): Promise<NoteView> {
    return firstValueFrom(this.http.post<NoteView>(`/api/notes/${id}/status`, { status }));
  }

  setCommentsOpen(id: number, open: boolean): Promise<NoteView> {
    return firstValueFrom(this.http.post<NoteView>(`/api/notes/${id}/comments-open`, { open }));
  }

  addComment(noteId: number, body: string): Promise<NoteView> {
    return firstValueFrom(this.http.post<NoteView>(`/api/notes/${noteId}/comments`, { body }));
  }

  deleteComment(id: number): Promise<NoteView> {
    return firstValueFrom(this.http.delete<NoteView>(`/api/comments/${id}`));
  }

  // ---- pictures
  media(contactId: number): Promise<IncidentMediaView[]> {
    return firstValueFrom(this.http.get<IncidentMediaView[]>(`/api/contacts/${contactId}/media`));
  }

  /** Every approved picture with a place on the map, newest first (the server sends at most 500). */
  mediaOnMap(): Promise<IncidentMediaView[]> {
    const params = new HttpParams().set('minLat', -90).set('minLon', -180).set('maxLat', 90).set('maxLon', 180);
    return firstValueFrom(this.http.get<IncidentMediaView[]>('/api/community-media', { params }));
  }

  /** Approved pictures placed near an incident, nearest first, leaving out the incident's own. */
  nearbyMedia(contactId: number, radiusKm = 2, limit = 8): Promise<NearbyPicture[]> {
    const params = new HttpParams().set('radiusKm', radiusKm).set('limit', limit);
    return firstValueFrom(this.http.get<NearbyPicture[]>(`/api/contacts/${contactId}/nearby-media`, { params }));
  }

  /** One picture as this viewer sees it (their own like, whether they can remove it), or `null` when there is no such picture for them. */
  mediaDetail(id: number): Promise<IncidentMediaView | null> {
    return firstValueFrom(this.http.get<IncidentMediaView>(`/api/incident-media/${id}`)).catch((e) => {
      if (e instanceof HttpErrorResponse && e.status === 404) {
        return null;
      }
      throw e;
    });
  }

  addMedia(contactId: number, file: File, caption: string, credit: string, dateTaken: string): Promise<IncidentMediaView> {
    const form = new FormData();
    form.append('file', file, file.name);
    for (const [key, value] of [['caption', caption], ['credit', credit], ['dateTaken', dateTaken]] as const) {
      if (value) {
        form.append(key, value);
      }
    }
    return firstValueFrom(this.http.post<IncidentMediaView>(`/api/contacts/${contactId}/media`, form));
  }

  removeMedia(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/incident-media/${id}`));
  }

  toggleLike(id: number): Promise<LikeResult> {
    return firstValueFrom(this.http.post<LikeResult>(`/api/incident-media/${id}/like`, {}));
  }

  setPictureStatus(mediaId: number, status: MediaStatus): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/studio/media/${mediaId}/status`, { status }));
  }

  // ---- honour roll
  casualties(contactId: number): Promise<HonourSummary[]> {
    return firstValueFrom(this.http.get<HonourSummary[]>(`/api/contacts/${contactId}/casualties`));
  }

  submitCasualty(contactId: number, input: CasualtyInput): Promise<CasualtyRow> {
    return firstValueFrom(this.http.post<CasualtyRow>(`/api/contacts/${contactId}/casualty-submissions`, input));
  }

  /** The roll by surname, for what was typed and the chosen service, rank and corps, with the choices for those drop-downs if `facets` is set. */
  honourRoll(q: string, page = 1, pageSize = 20, filters: HonourFilters = {}, facets = false): Promise<HonourPage> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (q.trim()) {
      params = params.set('q', q.trim());
    }
    for (const key of ['service', 'rank', 'corps'] as const) {
      const value = filters[key]?.trim();
      if (value) {
        params = params.set(key, value);
      }
    }
    if (facets) {
      params = params.set('facets', true);
    }
    return firstValueFrom(this.http.get<HonourPage>('/api/honour-roll', { params }));
  }

  person(serviceNumber: string): Promise<HonourPerson> {
    return firstValueFrom(this.http.get<HonourPerson>(`/api/honour-roll/${encodeURIComponent(serviceNumber)}`));
  }

  tributes(serviceNumber: string, page = 1): Promise<TributePage> {
    return firstValueFrom(this.http.get<TributePage>(`/api/honour-roll/${encodeURIComponent(serviceNumber)}/tributes`, { params: { page } }));
  }

  leaveTribute(serviceNumber: string, message: string): Promise<TributeView> {
    return firstValueFrom(this.http.post<TributeView>(`/api/honour-roll/${encodeURIComponent(serviceNumber)}/tributes`, { message }));
  }

  deleteTribute(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/tributes/${id}`));
  }

  // ---- moderation (editors)
  queue(): Promise<ModerationQueue> {
    return firstValueFrom(this.http.get<ModerationQueue>('/api/studio/moderation'));
  }

  markCasualty(id: number, handled: boolean): Promise<CasualtyRow> {
    return firstValueFrom(this.http.post<CasualtyRow>(`/api/studio/casualty-submissions/${id}/handled`, { handled }));
  }
}
