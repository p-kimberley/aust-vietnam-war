import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type ContentKind = 'Article' | 'Page';
export type ArticleStatus = 'Draft' | 'InReview' | 'Scheduled' | 'Published' | 'Archived';
export type MediaStatus = 'Pending' | 'Approved' | 'Rejected';

export const STATUS_LABEL: Record<ArticleStatus, string> = {
  Draft: 'Draft',
  InReview: 'In review',
  Scheduled: 'Scheduled',
  Published: 'Published',
  Archived: 'Archived',
};

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ArticleRow {
  id: number;
  kind: ContentKind;
  slug: string;
  title: string;
  status: ArticleStatus;
  authorName: string;
  categoryName: string | null;
  publishedUtc: string | null;
  scheduledUtc: string | null;
  updatedUtc: string;
}

/** What the editor sends. `version` is the version that was loaded (0 for a new item). */
export interface ArticleInput {
  title: string;
  slug: string | null;
  excerpt: string | null;
  /** The body, as Markdown. */
  bodyMarkdown: string;
  categoryId: number | null;
  featuredMediaId: number | null;
  featureOnHomepage: boolean;
  parentId: number | null;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  tags: string[];
  version: number;
}

export interface ArticleEdit {
  id: number;
  kind: ContentKind;
  slug: string;
  title: string;
  excerpt: string | null;
  /** The body as it is kept and edited. */
  bodyMarkdown: string;
  /** The body as readers get it, rendered and cleaned by the server when it was last saved (for the preview). */
  bodyHtml: string;
  status: ArticleStatus;
  authorId: number;
  authorName: string;
  categoryId: number | null;
  featuredMediaId: number | null;
  featuredMediaUrl: string | null;
  featureOnHomepage: boolean;
  parentId: number | null;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  tags: string[];
  publishedUtc: string | null;
  scheduledUtc: string | null;
  createdUtc: string;
  updatedUtc: string;
  version: number;
  canEdit: boolean;
  transitions: ArticleStatus[];
}

export interface RevisionSummary {
  revisionNo: number;
  title: string;
  authorName: string;
  createdUtc: string;
}

export interface RevisionDetail extends RevisionSummary {
  bodyMarkdown: string;
  bodyHtml: string;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
}

export interface MediaView {
  id: number;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  caption: string | null;
  credit: string | null;
  status: MediaStatus;
  uploadedByName: string;
  mine: boolean;
  createdUtc: string;
}

export interface ArticleQuery {
  kind?: ContentKind | '';
  status?: ArticleStatus | '';
  q?: string;
  page?: number;
  pageSize?: number;
}

function params(values: Record<string, string | number | undefined | null>): HttpParams {
  let p = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') {
      p = p.set(key, String(value));
    }
  }
  return p;
}

/** The message the API put in a problem response, or a fallback. */
export function problemMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof HttpErrorResponse) {
    const detail = (error.error as { detail?: string } | null)?.detail;
    if (detail) {
      return detail;
    }
    if (error.status === 0) {
      return 'The server could not be reached.';
    }
    if (error.status === 413) {
      return 'That file is too large.';
    }
  }
  return fallback;
}

export const isConflict = (error: unknown): boolean => error instanceof HttpErrorResponse && error.status === 409;

/** Typed calls to the Studio API. Every call is authorised again by the server; nothing here is a security check. */
@Injectable({ providedIn: 'root' })
export class StudioApi {
  private readonly http = inject(HttpClient);

  list(q: ArticleQuery): Promise<Paged<ArticleRow>> {
    return firstValueFrom(this.http.get<Paged<ArticleRow>>('/api/studio/articles', { params: params({ kind: q.kind, status: q.status, q: q.q, page: q.page, pageSize: q.pageSize ?? 20 }) }));
  }

  get(id: number): Promise<ArticleEdit> {
    return firstValueFrom(this.http.get<ArticleEdit>(`/api/studio/articles/${id}`));
  }

  create(kind: ContentKind, input: ArticleInput): Promise<ArticleEdit> {
    return firstValueFrom(this.http.post<ArticleEdit>('/api/studio/articles', input, { params: params({ kind }) }));
  }

  update(id: number, input: ArticleInput): Promise<ArticleEdit> {
    return firstValueFrom(this.http.put<ArticleEdit>(`/api/studio/articles/${id}`, input));
  }

  transition(id: number, status: ArticleStatus, version: number, scheduledUtc: string | null = null): Promise<ArticleEdit> {
    return firstValueFrom(this.http.post<ArticleEdit>(`/api/studio/articles/${id}/status`, { status, version, scheduledUtc }));
  }

  remove(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/studio/articles/${id}`));
  }

  revisions(id: number): Promise<RevisionSummary[]> {
    return firstValueFrom(this.http.get<RevisionSummary[]>(`/api/studio/articles/${id}/revisions`));
  }

  revision(id: number, no: number): Promise<RevisionDetail> {
    return firstValueFrom(this.http.get<RevisionDetail>(`/api/studio/articles/${id}/revisions/${no}`));
  }

  restore(id: number, no: number, version: number): Promise<ArticleEdit> {
    return firstValueFrom(this.http.post<ArticleEdit>(`/api/studio/articles/${id}/revisions/${no}/restore`, { version }));
  }

  categories(): Promise<Category[]> {
    return firstValueFrom(this.http.get<Category[]>('/api/studio/categories'));
  }

  createCategory(name: string): Promise<Category> {
    return firstValueFrom(this.http.post<Category>('/api/studio/categories', { name }));
  }

  media(q: { status?: MediaStatus | ''; q?: string; page?: number }): Promise<Paged<MediaView>> {
    return firstValueFrom(this.http.get<Paged<MediaView>>('/api/studio/media', { params: params({ status: q.status, q: q.q, page: q.page, pageSize: 24 }) }));
  }

  uploadMedia(file: File, caption: string, credit: string): Promise<MediaView> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (caption) {
      form.append('caption', caption);
    }
    if (credit) {
      form.append('credit', credit);
    }
    return firstValueFrom(this.http.post<MediaView>('/api/studio/media', form));
  }

  updateMedia(id: number, caption: string | null, credit: string | null): Promise<MediaView> {
    return firstValueFrom(this.http.put<MediaView>(`/api/studio/media/${id}`, { caption, credit }));
  }

  setMediaStatus(id: number, status: MediaStatus): Promise<MediaView> {
    return firstValueFrom(this.http.post<MediaView>(`/api/studio/media/${id}/status`, { status }));
  }
}
