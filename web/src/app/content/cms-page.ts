import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UrlMatcher, UrlSegment } from '@angular/router';
import { Seo } from '../core/seo.service';
import { NotFound } from '../pages/not-found';
import { PageView, isNotFound } from './content';
import { CmsBody } from './cms-body';

/** First path segments that belong to the application or its infrastructure, never to an authored page. */
const RESERVED = new Set(['api', 'studio', 'battlemap', 'articles', 'media', 'forbidden', 'feedback', 'feed.xml', 'sitemap.xml', 'vendor', 'assets']);

/** Matches any non-reserved path and hands the whole thing to the page as `path` (for example `about/team`). */
export const cmsPageMatcher: UrlMatcher = (segments) => {
  if (!segments.length || RESERVED.has(segments[0].path)) {
    return null;
  }
  return { consumed: segments, posParams: { path: new UrlSegment(segments.map((s) => s.path).join('/'), {}) } };
};

/** An authored page such as About or Team, found by its path. Shows Not found when there is no such published page. */
@Component({
  selector: 'app-cms-page',
  imports: [RouterLink, CmsBody, NotFound],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (page.hasValue()) {
      @let p = page.value();
      <div class="wrap layout">
        <article class="page">
          @if (p.breadcrumbs.length) {
            <nav class="crumbs data" aria-label="Breadcrumb">
              @for (b of p.breadcrumbs; track b.path) {
                <a [routerLink]="'/' + b.path">{{ b.title }}</a>
                <span aria-hidden="true">/</span>
              }
            </nav>
          }
          <h1>{{ p.title }}</h1>
          <app-cms-body [html]="p.bodyHtml" />
        </article>

        @if (p.children.length) {
          <aside class="children" aria-label="In this section">
            <h2>In this section</h2>
            <ul>
              @for (c of p.children; track c.path) {
                <li><a [routerLink]="'/' + c.path">{{ c.title }}</a></li>
              }
            </ul>
          </aside>
        }
      </div>
    } @else if (notFound()) {
      <app-not-found />
    } @else if (page.error()) {
      <p class="wrap pad" role="alert">This page could not be loaded. Please try again shortly.</p>
    } @else {
      <p class="wrap pad data" aria-live="polite">Loading…</p>
    }
  `,
  styles: `
    .layout {
      display: grid;
      gap: 2rem 3rem;
      padding-block: 2.5rem;
      grid-template-columns: minmax(0, 1fr);
    }
    @media (min-width: 60rem) {
      .layout:has(.children) {
        grid-template-columns: minmax(0, 1fr) 16rem;
      }
    }
    .pad {
      padding-block: 2.5rem;
    }
    .crumbs {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 0.75rem;
      color: var(--text-muted);
      font-size: 0.95rem;
    }
    .children {
      align-self: start;
      padding: 1rem 1.25rem;
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-top: 4px solid var(--brass);
    }
    .children h2 {
      font-size: 1.1rem;
    }
    .children ul {
      margin: 0;
      padding-left: 1.1rem;
    }
  `,
})
export class CmsPage {
  readonly path = input.required<string>();

  private readonly seo = inject(Seo);

  protected readonly page = httpResource<PageView>(() => `/api/content/page/${this.path().split('/').map(encodeURIComponent).join('/')}`);
  protected notFound = () => isNotFound(this.page.error());

  constructor() {
    effect(() => {
      if (!this.page.hasValue()) {
        return;
      }
      const p = this.page.value();
      this.seo.set({ title: p.seoTitle || p.title, description: p.seoDescription, path: `/${p.path}`, modified: p.updatedUtc });
    });
  }
}
