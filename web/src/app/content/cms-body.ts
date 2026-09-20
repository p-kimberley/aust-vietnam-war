import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

/**
 * Renders an article or page body. The API has already reduced the HTML to a small allowlist (see ContentSanitizer),
 * and Angular's own sanitiser would strip the video frames it deliberately allows, so this is the one place the
 * markup is trusted. Never pass anything here that did not come from the content API.
 */
@Component({
  selector: 'app-cms-body',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `<div class="prose" [innerHTML]="safe()"></div>`,
  styles: `
    .prose {
      max-width: 44rem;
      font-size: 1.125rem;
      line-height: 1.7;
      overflow-wrap: break-word;
    }
    .prose > :first-child {
      margin-top: 0;
    }
    .prose h2,
    .prose h3,
    .prose h4 {
      margin: 1.8em 0 0.5em;
    }
    .prose h4 {
      font-family: var(--font-display);
      font-size: 1.1rem;
      text-transform: uppercase;
    }
    .prose li > p {
      margin: 0.2em 0;
    }
    .prose blockquote {
      margin: 1.5em 0;
      padding: 0.25em 1.25em;
      border-left: 4px solid var(--brass);
      background: var(--surface-raised);
      font-style: italic;
    }
    .prose img,
    .prose iframe {
      max-width: 100%;
      height: auto;
      border-radius: var(--radius);
    }
    .prose iframe {
      width: 100%;
      aspect-ratio: 16 / 9;
      border: 0;
    }
    .prose figure {
      margin: 1.5em 0;
    }
    .prose figcaption {
      font-family: var(--font-data);
      font-size: 0.9rem;
      color: var(--text-muted);
    }
    .prose table {
      display: block;
      max-width: 100%;
      overflow-x: auto;
      border-collapse: collapse;
    }
    .prose th,
    .prose td {
      border: 1px solid var(--rule);
      padding: 0.4em 0.75em;
      text-align: left;
    }
    .prose th {
      background: var(--surface-raised);
    }
    .prose pre {
      overflow-x: auto;
      padding: 1em;
      background: var(--olive-900);
      color: var(--khaki);
      border-radius: var(--radius);
    }
    .prose code {
      font-family: var(--font-data);
    }
    .prose hr {
      border: 0;
      border-top: 2px solid var(--rule);
      margin: 2em 0;
    }
  `,
})
export class CmsBody {
  readonly html = input.required<string>();
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly safe = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.html()));
}
