import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Narrative, paragraphs } from './timeline-data';

/**
 * A narrative's paragraphs, each `[n]` a small raised link to its source in the numbered list after them. Words without a mark
 * are the record's own (see STYLE.md).
 */
@Component({
  selector: 'app-narrative-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (p of parts(); track $index) {
      <p>
        @for (part of p; track $index) {
          @if ('source' in part) {
            <sup><a class="cite" [href]="'#' + id() + '-src-' + part.source" [attr.aria-label]="'Source ' + part.source">{{ part.source }}</a></sup>
          } @else {{{ part.text }}}
        }
      </p>
    }
    @if (narrative().sources.length) {
      <ol class="sources" [attr.aria-label]="'Sources'">
        @for (s of narrative().sources; track s.url; let i = $index) {
          <li [id]="id() + '-src-' + (i + 1)">
            <a [href]="s.url" target="_blank" rel="noopener">{{ s.title }}</a><span class="publisher">, {{ s.publisher }}</span>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    p {
      max-width: 46rem;
      margin: 0 0 0.8rem;
      line-height: 1.55;
    }
    sup {
      line-height: 0;
    }
    .cite {
      padding: 0 0.1rem;
      font-size: 0.72rem;
      font-weight: 600;
      text-decoration: none;
    }
    .sources {
      max-width: 46rem;
      margin: 0.4rem 0 0;
      padding-left: 1.4rem;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .sources li {
      margin: 0.15rem 0;
    }
    .sources li:target {
      background: color-mix(in srgb, var(--brass) 25%, transparent);
    }
  `,
})
export class NarrativeText {
  readonly narrative = input.required<Narrative>();
  /** Makes the marks' and sources' ids unique on the page (a phase's slug, say). */
  readonly id = input.required<string>();

  protected readonly parts = computed(() => paragraphs(this.narrative().text));
}
