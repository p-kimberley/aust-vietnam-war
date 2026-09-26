import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { renderHistory } from './history-markdown';
import { UnitToc } from './unit-toc';

/**
 * A unit's history, as its history.md has it: the head from its front matter (dates, figures, the Battle Map and its record), the
 * contents from its sections, and the history itself.
 */
@Component({
  selector: 'app-unit-history',
  imports: [RouterLink, UnitToc],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The history's HTML is made from Markdown, outside Angular's templates, so its styles cannot be scoped to them.
  encapsulation: ViewEncapsulation.None,
  template: `
    @let h = rendered().head;
    <header class="uh-head">
      <p class="data uh-kicker">{{ h.arm }} · {{ h.tours }}</p>
      <h1>{{ h.title }}</h1>
      <dl class="uh-figures">
        <div><dt>Contacts</dt><dd class="data">{{ h.contacts }}</dd></div>
        <div><dt>Operations</dt><dd class="data">{{ h.operations }}</dd></div>
        <div><dt>Dead</dt><dd class="data">{{ h.dead }}</dd></div>
        <div><dt>Australian wounded</dt><dd class="data">{{ h.wounded }}</dd></div>
        <div><dt>Enemy killed</dt><dd class="data">{{ h.enemyKilled }}</dd></div>
      </dl>
      <p class="uh-actions">
        <a class="btn" [routerLink]="'/battlemap'" [queryParams]="{ units: h.id }">View on the Battle Map</a>
        @if (h.record) {
          <a class="btn btn--quiet" [href]="h.record" rel="noopener" target="_blank">Australian War Memorial record</a>
        }
      </p>
      <app-unit-toc [entries]="rendered().sections" [path]="'/features/unit-histories/' + h.unit" />
    </header>
    <!-- The history's links are the site's own addresses: followed here without reloading the page. -->
    <div class="uh-body" [innerHTML]="html()" (click)="clicked($event)"></div>
  `,
  styles: `
    .uh-kicker {
      margin: 0 0 0.5rem;
      color: var(--text-muted);
    }
    .uh-head h1 {
      font-size: clamp(1.8rem, 4vw, 2.6rem);
    }
    .uh-figures {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 2rem;
      margin: 1rem 0;
    }
    .uh-figures dt {
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .uh-figures dd {
      margin: 0;
      font-size: 1.6rem;
    }
    .uh-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .uh-body {
      max-width: 52rem;
    }
    .uh-body h2 {
      margin-top: 2.5rem;
    }
    .uh-body h3 {
      margin-top: 1.75rem;
      font-size: 1.15rem;
    }
    .uh-body h2,
    .uh-body h3 {
      scroll-margin-top: 1rem;
    }
    /* A heading's own link: shown when the heading is pointed at, or the link has the keyboard. */
    .uh-body .anchor {
      margin-left: 0.35em;
      color: var(--text-muted);
      text-decoration: none;
      opacity: 0;
    }
    .uh-body :is(h2, h3):hover .anchor,
    .uh-body .anchor:focus-visible {
      opacity: 1;
    }
    @media (hover: none) {
      .uh-body .anchor {
        opacity: 0.5;
      }
    }
    .uh-body h3.is-current .anchor {
      color: var(--khaki);
    }
    .uh-body h3.is-current {
      padding: 0.4rem 0.6rem;
      background: var(--olive-700);
      color: var(--paper);
      border-radius: var(--radius);
    }
    .uh-body h3 + p em {
      color: var(--text-muted);
    }
    .uh-body .table {
      overflow-x: auto;
    }
    .uh-body table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.95rem;
    }
    .uh-body th,
    .uh-body td {
      padding: 0.35rem 0.6rem;
      border-bottom: 1px solid var(--rule);
      vertical-align: top;
    }
    .uh-body th:not([align]),
    .uh-body td:not([align]) {
      text-align: left;
    }
    .uh-body thead th {
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .uh-body .is-collapsed tbody tr:nth-child(n + 11) {
      display: none;
    }
    .uh-body .show-more {
      margin-top: 0.5rem;
      padding: 0.25rem 0.8rem;
      font: inherit;
      font-size: 0.9rem;
      color: var(--text);
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-radius: var(--radius);
      cursor: pointer;
    }
    .uh-body .gallery {
      display: grid;
      gap: 1rem;
      padding: 0;
      list-style: none;
    }
    .uh-body .gallery--roll-of-honour {
      grid-template-columns: repeat(auto-fill, minmax(12.5rem, 1fr));
      font-size: 0.95rem;
      line-height: 1.35;
    }
    .uh-body .gallery--roll-of-honour img {
      float: left;
      width: 4rem;
      height: 5.33rem;
      margin-right: 0.75rem;
      object-fit: cover;
      background: var(--field);
      border-radius: var(--radius);
      filter: grayscale(1);
    }
    .uh-body .gallery--roll-of-honour a {
      font-weight: 600;
    }
    .uh-body .gallery--photographs {
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      font-size: 0.9rem;
    }
    .uh-body .gallery--photographs img {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      margin-bottom: 0.35rem;
      object-fit: cover;
      border-radius: var(--radius);
    }
  `,
})
export class UnitHistory {
  /** The unit's history.md. */
  readonly markdown = input.required<string>();
  /** The sub-unit section the address names, which is marked out. */
  readonly sub = input<string | null>(null);

  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);

  protected readonly rendered = computed(() => renderHistory(this.markdown(), this.sub()));
  /** Made by `renderHistory` from the repository's own Markdown, with any HTML in it shown as text: safe as it is. */
  protected readonly html = computed(() => this.sanitizer.bypassSecurityTrustHtml(this.rendered().html));

  protected clicked(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const more = target.closest<HTMLButtonElement>('button[data-more]');
    if (more) {
      const wrap = more.parentElement!;
      const collapsed = wrap.classList.toggle('is-collapsed');
      more.textContent = collapsed ? `Show all ${wrap.querySelectorAll('tbody tr').length}` : 'Show fewer';
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a[href]');
    const href = link?.getAttribute('href');
    if (!href || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const [path, fragment] = href.split('#');
    if (fragment !== undefined && (path === '' || path === this.doc.location?.pathname)) {
      // A section of this page (a heading's own link): go to it, and put its address in the address bar to copy.
      event.preventDefault();
      this.doc.getElementById(decodeURIComponent(fragment))?.scrollIntoView({ block: 'start' });
      if (path) this.doc.defaultView?.history.replaceState(this.doc.defaultView.history.state, '', href);
    } else if (href.startsWith('/') && !href.startsWith('/media/')) {
      event.preventDefault();
      void this.router.navigateByUrl(href);
    }
  }
}
