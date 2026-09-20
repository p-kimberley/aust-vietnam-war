import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Seo } from '../core/seo.service';
import { ArticleCardView } from './article-card';
import { ArticleCard, CategoryView, Paged } from './content';

const PAGE_SIZE = 12;

/** `/articles`, optionally narrowed by `?category=` and paged by `?page=` (bound from the URL by the router). */
@Component({
  selector: 'app-article-list',
  imports: [RouterLink, ArticleCardView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap page">
      <h1>Stories</h1>

      <form class="search" role="search" (submit)="$event.preventDefault(); search(box.value)">
        <label class="visually-hidden" for="story-search">Search stories</label>
        <input #box id="story-search" type="search" [value]="q() ?? ''" placeholder="Search stories" maxlength="100" />
        <button class="btn" type="submit">Search</button>
      </form>

      @if (categories.value().length) {
        <nav class="filters" aria-label="Categories">
          <a class="chip" routerLink="/articles" [class.is-on]="!category()">All</a>
          @for (c of categories.value(); track c.slug) {
            <a class="chip" routerLink="/articles" [queryParams]="{ category: c.slug }" [class.is-on]="category() === c.slug">{{ c.name }}</a>
          }
        </nav>
      }

      @if (articles.error()) {
        <p role="alert">The stories could not be loaded. Please try again shortly.</p>
      } @else if (articles.hasValue()) {
        @if (articles.value().items.length) {
          <h2 class="visually-hidden">{{ category() ? 'Stories in this category' : 'All stories' }}</h2>
          <div class="grid">
            @for (a of articles.value().items; track a.slug) {
              <app-article-card [article]="a" />
            }
          </div>

          @if (pages() > 1) {
            <nav class="pager" aria-label="Pages of stories">
              @if (current() > 1) {
                <a [routerLink]="[]" [queryParams]="link(current() - 1)" rel="prev">Newer</a>
              }
              <span class="data">Page {{ current() }} of {{ pages() }}</span>
              @if (current() < pages()) {
                <a [routerLink]="[]" [queryParams]="link(current() + 1)" rel="next">Older</a>
              }
            </nav>
          }
        } @else {
          <p>{{ q() ? 'No stories match “' + q() + '”.' : 'No stories have been published here yet.' }}</p>
        }
      } @else {
        <p class="data" aria-live="polite">Loading…</p>
      }
    </div>
  `,
  styles: `
    .page {
      padding-block: 2.5rem;
    }
    .search {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      max-width: 28rem;
    }
    .search input {
      flex: 1;
      padding: 0.5rem;
      font: inherit;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }
    .chip {
      padding: 0.25rem 0.8rem;
      border: 1px solid var(--rule);
      border-radius: 999px;
      color: var(--text);
      text-decoration: none;
      font-family: var(--font-data);
      font-size: 0.95rem;
    }
    .chip.is-on {
      background: var(--olive-900);
      color: var(--paper);
      border-color: var(--olive-900);
    }
    .grid {
      display: grid;
      gap: 1.5rem;
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    }
    .pager {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 1.5rem;
      margin-top: 2rem;
    }
  `,
})
export class ArticleList {
  readonly category = input<string | undefined>();
  readonly q = input<string | undefined>();
  readonly page = input<string | undefined>();

  private readonly seo = inject(Seo);
  private readonly router = inject(Router);

  protected readonly current = computed(() => Math.max(1, Number.parseInt(this.page() ?? '1', 10) || 1));

  protected readonly articles = httpResource<Paged<ArticleCard>>(() => ({
    url: '/api/content/articles',
    params: { pageSize: PAGE_SIZE, page: this.current(), ...(this.category() ? { category: this.category()! } : {}), ...(this.q() ? { q: this.q()! } : {}) },
  }));
  protected readonly categories = httpResource<CategoryView[]>(() => '/api/content/categories', { defaultValue: [] });

  protected readonly pages = computed(() => {
    const paged = this.articles.hasValue() ? this.articles.value() : null;
    return paged ? Math.ceil(paged.total / paged.pageSize) : 1;
  });

  constructor() {
    effect(() => {
      const name = this.categories.value().find((c) => c.slug === this.category())?.name;
      this.seo.set({
        title: name ? `Stories: ${name}` : 'Stories',
        description: "Articles and research about Australians' service in the Vietnam War.",
        path: '/articles' + (this.category() ? `?category=${this.category()}` : ''),
      });
    });
  }

  protected search(text: string): void {
    void this.router.navigate(['/articles'], { queryParams: { q: text.trim() || null, category: this.category() ?? null } });
  }

  protected link(page: number): Record<string, string | null> {
    return { category: this.category() ?? null, q: this.q() ?? null, page: page > 1 ? String(page) : null };
  }
}
