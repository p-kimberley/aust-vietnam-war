import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
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
            <sup><a class="cite" [href]="page() + '#' + sourceId(part.source)" [attr.aria-label]="'Source ' + part.source" (click)="toSource($event, part.source)">{{ part.source }}</a></sup>
          } @else {{{ part.text }}}
        }
      </p>
    }
    @if (narrative().sources.length) {
      <ol class="sources" [attr.aria-label]="'Sources'">
        @for (s of narrative().sources; track s.url; let i = $index) {
          <li [id]="sourceId(i + 1)" [class.is-shown]="shown() === i + 1">
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
    /* The source a mark was followed to, picked out for a moment. */
    .sources li {
      margin: 0.15rem 0;
      scroll-margin: 5rem 0 3rem;
      transition: background-color 0.4s;
    }
    .sources li:target,
    .sources li.is-shown {
      background: color-mix(in srgb, var(--brass) 25%, transparent);
    }
  `,
})
export class NarrativeText {
  readonly narrative = input.required<Narrative>();
  /** Makes the marks' and sources' ids unique on the page (a phase's slug, say). */
  readonly id = input.required<string>();

  protected readonly parts = computed(() => paragraphs(this.narrative().text));
  /** The source a mark was last followed to, picked out for a moment. */
  protected readonly shown = signal<number | null>(null);

  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private timer?: ReturnType<typeof setTimeout>;

  /**
   * This page's own address, before its fragment: the site's base address is its root, so a bare "#…" would lead to the home
   * page. The mark's link keeps working copied or opened in a new tab.
   */
  protected readonly page = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url.split('#')[0]),
    ),
    { initialValue: this.router.url.split('#')[0] },
  );

  protected sourceId(n: number): string {
    return `${this.id()}-src-${n}`;
  }

  /** Brings the source into view and picks it out, without leaving the page (which would lose what the reader has opened). */
  protected toSource(event: MouseEvent, n: number): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.document.getElementById(this.sourceId(n))?.scrollIntoView?.({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
    this.shown.set(n);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.shown.set(null), 2000);
  }
}
