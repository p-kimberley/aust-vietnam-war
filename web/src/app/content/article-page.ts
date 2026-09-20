import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Seo } from '../core/seo.service';
import { NotFound } from '../pages/not-found';
import { ArticleCardView } from './article-card';
import { ArticleView, isNotFound } from './content';
import { CmsBody } from './cms-body';

/** `/articles/:slug`. Rendered on the server so search engines and link previews get the full text. */
@Component({
  selector: 'app-article-page',
  imports: [RouterLink, DatePipe, CmsBody, ArticleCardView, NotFound],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (article.hasValue()) {
      @let a = article.value();
      <article class="wrap page">
        <header class="head">
          <p class="data meta">
            <time [attr.datetime]="a.publishedUtc">{{ a.publishedUtc | date: 'd MMMM y' : 'UTC' }}</time>
            <span aria-hidden="true">·</span>
            <span>{{ a.authorName }}</span>
            @if (a.categoryName) {
              <span aria-hidden="true">·</span>
              <a routerLink="/articles" [queryParams]="{ category: a.categorySlug }">{{ a.categoryName }}</a>
            }
          </p>
          <h1>{{ a.title }}</h1>
          @if (a.excerpt) {
            <p class="lead">{{ a.excerpt }}</p>
          }
        </header>

        @if (a.imageUrl) {
          <figure class="hero">
            <img [src]="a.imageUrl" [alt]="a.imageCaption ?? ''" />
            @if (a.imageCaption) {
              <figcaption class="data">{{ a.imageCaption }}</figcaption>
            }
          </figure>
        }

        <app-cms-body [html]="a.bodyHtml" />

        @if (a.tags.length) {
          <p class="tags data">
            @for (t of a.tags; track t.slug) {
              <span class="tag">{{ t.name }}</span>
            }
          </p>
        }

        @if (a.related.length) {
          <aside class="related" aria-labelledby="related-title">
            <h2 id="related-title">More in {{ a.categoryName }}</h2>
            <div class="grid">
              @for (r of a.related; track r.slug) {
                <app-article-card [article]="r" />
              }
            </div>
          </aside>
        }
      </article>
    } @else if (notFound()) {
      <app-not-found />
    } @else if (article.error()) {
      <p class="wrap page" role="alert">This story could not be loaded. Please try again shortly.</p>
    } @else {
      <p class="wrap page data" aria-live="polite">Loading…</p>
    }
  `,
  styles: `
    .page {
      padding-block: 2.5rem;
    }
    .meta {
      margin: 0 0 0.75rem;
      color: var(--text-muted);
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
    h1 {
      font-size: clamp(1.8rem, 4.5vw, 2.8rem);
      max-width: 22em;
    }
    .lead {
      max-width: 44rem;
      font-size: 1.3rem;
      color: var(--text-muted);
    }
    .hero {
      margin: 1.5rem 0;
    }
    .hero img {
      display: block;
      width: 100%;
      max-height: 32rem;
      object-fit: cover;
      border-radius: var(--radius);
    }
    figcaption {
      margin-top: 0.4rem;
      color: var(--text-muted);
      font-size: 0.9rem;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 2rem;
    }
    .tag {
      padding: 0.1rem 0.6rem;
      border: 1px solid var(--rule);
      border-radius: 999px;
      font-size: 0.9rem;
    }
    .related {
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 2px solid var(--rule);
    }
    .grid {
      display: grid;
      gap: 1.5rem;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    }
  `,
})
export class ArticlePage {
  readonly slug = input.required<string>();

  private readonly seo = inject(Seo);

  protected readonly article = httpResource<ArticleView>(() => `/api/content/articles/${encodeURIComponent(this.slug())}`);
  protected notFound = () => isNotFound(this.article.error());

  constructor() {
    effect(() => {
      if (!this.article.hasValue()) {
        return;
      }
      const a = this.article.value();
      const path = `/articles/${a.slug}`;
      this.seo.set({
        title: a.seoTitle || a.title,
        description: a.seoDescription || a.excerpt,
        path,
        image: a.imageUrl,
        type: 'article',
        published: a.publishedUtc,
        modified: a.updatedUtc,
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: a.title,
          description: a.seoDescription || a.excerpt || undefined,
          datePublished: a.publishedUtc,
          dateModified: a.updatedUtc,
          author: { '@type': 'Person', name: a.authorName },
          image: a.imageUrl ? this.seo.absolute(a.imageUrl) : undefined,
          mainEntityOfPage: this.seo.absolute(path),
        },
      });
    });
  }
}
