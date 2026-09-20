import { HttpClient, HttpParams } from '@angular/common/http';
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
  contactId: number;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  caption: string | null;
  credit: string | null;
  dateTaken: string | null;
  status: MediaStatus;
  likes: number;
  likedByMe: boolean;
  mine: boolean;
  canRemove: boolean;
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

export interface HonourPage {
  items: HonourSummary[];
  total: number;
  page: number;
  pageSize: number;
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
  contactId: number;
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

  honourRoll(q: string, page = 1, pageSize = 20): Promise<HonourPage> {
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (q.trim()) {
      params = params.set('q', q.trim());
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
