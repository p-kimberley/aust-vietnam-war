import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-site-footer',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="foot">
      <div class="wrap foot__inner">
        <p class="data">
          Australia's Vietnam War · 1965–1971. A memorial record, kept in memory of those who served.
        </p>
        <nav aria-label="Footer">
          <a routerLink="/about">About</a>
          <a routerLink="/battlemap">Battle Map</a>
        </nav>
      </div>
    </footer>
  `,
  styles: `
    .foot {
      background: var(--olive-900);
      color: var(--khaki);
      border-top: 4px solid var(--brass);
      margin-top: 4rem;
      padding-block: 1.5rem;
      font-size: 0.9rem;
    }
    .foot__inner {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 1rem;
    }
    p {
      margin: 0;
    }
    nav {
      display: flex;
      gap: 1.25rem;
    }
    a {
      color: var(--khaki);
    }
    a:hover {
      color: var(--smoke-yellow);
    }
  `,
})
export class SiteFooter {}
