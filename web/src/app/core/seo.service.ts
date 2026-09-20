import { DOCUMENT } from '@angular/common';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

/**
 * The public address of the site, used for canonical links and Open Graph URLs. In the browser it is the page's
 * own origin; the server config supplies it from the PUBLIC_URL setting because behind the ingress the server
 * cannot tell what address readers use.
 */
export const SITE_URL = new InjectionToken<string>('SITE_URL', {
  providedIn: 'root',
  factory: () => inject(DOCUMENT).location?.origin ?? '',
});

export const SITE_NAME = "Australia's Vietnam War";

export interface SeoInput {
  /** The page's own title; the site name is added. */
  title: string;
  description?: string | null;
  /** Site-relative path, for the canonical link. */
  path: string;
  /** Site-relative or absolute image URL for social previews. */
  image?: string | null;
  type?: 'website' | 'article';
  published?: string | null;
  modified?: string | null;
  /** Structured data to embed (Article, BreadcrumbList...). */
  jsonLd?: object | null;
}

/** Sets the title, description, canonical link, Open Graph tags and structured data for a public page. */
@Injectable({ providedIn: 'root' })
export class Seo {
  private readonly titleService = inject(Title);
  private readonly meta = inject(Meta);
  private readonly doc = inject(DOCUMENT);
  private readonly siteUrl = inject(SITE_URL);

  set(input: SeoInput): void {
    const title = input.title === SITE_NAME ? SITE_NAME : `${input.title} · ${SITE_NAME}`;
    const url = this.absolute(input.path);
    const image = input.image ? this.absolute(input.image) : null;
    const description = input.description?.trim() || null;

    this.titleService.setTitle(title);
    this.tag('name', 'description', description);
    this.tag('property', 'og:title', input.title);
    this.tag('property', 'og:description', description);
    this.tag('property', 'og:url', url);
    this.tag('property', 'og:type', input.type ?? 'website');
    this.tag('property', 'og:site_name', SITE_NAME);
    this.tag('property', 'og:image', image);
    this.tag('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    this.tag('property', 'article:published_time', input.published ?? null);
    this.tag('property', 'article:modified_time', input.modified ?? null);
    this.canonical(url);
    this.jsonLd(input.jsonLd ?? null);
  }

  absolute(path: string): string {
    return /^https?:\/\//.test(path) ? path : this.siteUrl + (path.startsWith('/') ? path : `/${path}`);
  }

  /** Sets a tag, or removes it when the value is empty so a page never inherits the previous page's text. */
  private tag(attribute: 'name' | 'property', key: string, content: string | null): void {
    const selector = `${attribute}="${key}"`;
    if (content) {
      this.meta.updateTag({ [attribute]: key, content }, selector);
    } else {
      this.meta.removeTag(selector);
    }
  }

  private canonical(url: string): void {
    let link = this.doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.rel = 'canonical';
      this.doc.head.appendChild(link);
    }
    link.href = url;
  }

  private jsonLd(data: object | null): void {
    const id = 'avw-json-ld';
    this.doc.getElementById(id)?.remove();
    if (!data) {
      return;
    }
    const script = this.doc.createElement('script');
    script.id = id;
    script.type = 'application/ld+json';
    // "<" is escaped so text such as "</script>" in a title can never end the block early.
    script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
    this.doc.head.appendChild(script);
  }
}
