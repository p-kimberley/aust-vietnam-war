import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

/** The page's sections, as a list at the top, each opened in place. */
@Component({
  selector: 'app-unit-toc',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-labelledby="toc-title">
      <h2 id="toc-title" class="data">On this page</h2>
      <ol>
        @for (e of entries(); track e.id) {
          <li><a [href]="path() + '#' + e.id" (click)="go($event, e.id)">{{ e.label }}</a></li>
        }
      </ol>
    </nav>
  `,
  styles: `
    nav {
      margin-top: 1.5rem;
      padding: 0.75rem 1rem;
      border: 1px solid var(--rule);
      border-left: 4px solid var(--olive-500);
      border-radius: var(--radius);
    }
    h2 {
      margin: 0 0 0.4rem;
      font-family: var(--font-data);
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    ol {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem 1.25rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
  `,
})
export class UnitToc {
  readonly entries = input.required<readonly { id: string; label: string }[]>();
  /** The page's own address, so that a link followed without the app (or opened in a new tab) still lands on the section. */
  readonly path = input.required<string>();

  private readonly doc = inject(DOCUMENT);

  /** Scrolls to the section in place (without a full page load). */
  protected go(event: MouseEvent, id: string): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    this.doc.getElementById(id)?.scrollIntoView({ block: 'start' });
  }
}
