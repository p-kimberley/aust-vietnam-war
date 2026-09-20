import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ArticleCard } from './content';

@Component({
  selector: 'app-article-card',
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      @if (article().imageUrl) {
        <a class="card__image" [routerLink]="['/articles', article().slug]" tabindex="-1" aria-hidden="true">
          <img [src]="article().imageUrl" [alt]="article().imageCaption ?? ''" loading="lazy" />
        </a>
      }
      <div class="card__text">
        <p class="data card__meta">
          <time [attr.datetime]="article().publishedUtc">{{ article().publishedUtc | date: 'd MMM y' : 'UTC' }}</time>
          @if (article().categoryName) {
            <span aria-hidden="true">·</span>
            <a [routerLink]="['/articles']" [queryParams]="{ category: article().categorySlug }">{{ article().categoryName }}</a>
          }
        </p>
        <h3 class="card__title">
          <a [routerLink]="['/articles', article().slug]">{{ article().title }}</a>
        </h3>
        @if (article().excerpt) {
          <p class="card__excerpt">{{ article().excerpt }}</p>
        }
      </div>
    </article>
  `,
  styles: `
    .card {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-top: 4px solid var(--brass);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .card__image img {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
    }
    .card__text {
      padding: 1rem 1.25rem 1.25rem;
    }
    .card__meta {
      margin: 0 0 0.4rem;
      font-size: 0.9rem;
      color: var(--text-muted);
      display: flex;
      gap: 0.4rem;
    }
    .card__title {
      font-size: 1.25rem;
      text-transform: none;
      margin-bottom: 0.4em;
    }
    .card__title a {
      color: inherit;
      text-decoration: none;
    }
    .card__title a:hover {
      text-decoration: underline;
    }
    .card__excerpt {
      margin: 0;
      color: var(--text-muted);
    }
  `,
})
export class ArticleCardView {
  readonly article = input.required<ArticleCard>();
}
