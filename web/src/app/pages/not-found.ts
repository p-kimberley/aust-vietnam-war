import { ChangeDetectionStrategy, Component, RESPONSE_INIT, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap page">
      <h1>Page not found</h1>
      <p>We couldn't find that page.</p>
      <a routerLink="/">Back to the home page</a>
    </div>
  `,
  styles: `
    .page {
      padding-block: 3rem;
    }
  `,
})
export class NotFound {
  constructor() {
    // During SSR this becomes the HTTP status, so crawlers see a real 404 rather than a soft one.
    // It is null in the browser.
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) {
      response.status = 404;
    }
  }
}
