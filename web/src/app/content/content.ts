import { httpResource } from '@angular/common/http';
import { Injectable } from '@angular/core';

export interface TagView {
  slug: string;
  name: string;
}

export interface CategoryView {
  id: number;
  slug: string;
  name: string;
}

export interface ArticleCard {
  slug: string;
  title: string;
  excerpt: string | null;
  publishedUtc: string;
  authorName: string;
  categorySlug: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  imageCaption: string | null;
}

export interface ArticleView extends ArticleCard {
  bodyHtml: string;
  updatedUtc: string;
  seoTitle: string | null;
  seoDescription: string | null;
  tags: TagView[];
  related: ArticleCard[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageLink {
  title: string;
  path: string;
}

export interface PageNode {
  title: string;
  path: string;
  children: PageNode[];
}

export interface PageView {
  title: string;
  path: string;
  bodyHtml: string;
  updatedUtc: string;
  seoTitle: string | null;
  seoDescription: string | null;
  breadcrumbs: PageLink[];
  children: PageLink[];
}

/** The pages of the public site, as a tree, for the navigation. Shared so the header and footer make one request. */
@Injectable({ providedIn: 'root' })
export class SiteNav {
  readonly pages = httpResource<PageNode[]>(() => '/api/content/pages', { defaultValue: [] });
}

/** Whether a failed request means "there is no such thing" rather than a fault. */
export function isNotFound(error: unknown): boolean {
  return (error as { status?: number } | undefined)?.status === 404;
}
