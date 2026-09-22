import { ChangeDetectionStrategy, Component, ElementRef, inject, input, model } from '@angular/core';

/** One tool in the rail at the left edge of the map. More are added by listing them; nothing else needs to change here. */
export interface LeftTab {
  id: string;
  label: string;
}

/**
 * The rail of tabs at the top left of the map, each with its label running down the tab. Choosing a tab opens that tool in a
 * panel that flies out beside the rail; choosing the open tab again shuts it. It follows the ARIA tabs pattern for a vertical
 * list: one tab is in the tab order, and the up and down arrows, Home and End move between them.
 */
@Component({
  selector: 'app-left-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tabs" role="tablist" aria-orientation="vertical" aria-label="Map tools">
      @for (tab of tabs(); track tab.id; let i = $index) {
        <button
          type="button"
          role="tab"
          class="tab"
          [class.is-on]="tab.id === active()"
          [id]="'left-tab-' + tab.id"
          [attr.aria-selected]="tab.id === active()"
          [attr.aria-controls]="panelId()"
          [attr.tabindex]="i === focusable() ? 0 : -1"
          (click)="choose(tab.id)"
          (keydown)="onKeydown($event, i)"
        >
          <span class="tab__text">{{ tab.label }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .tabs {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .tab {
      display: grid;
      place-items: center;
      width: 2.1rem;
      padding: 0.8rem 0;
      color: var(--khaki);
      font: inherit;
      font-family: var(--font-display);
      font-size: 0.85rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      background: color-mix(in srgb, var(--olive-900) 94%, transparent);
      border: 1px solid var(--olive-500);
      border-left: 0;
      border-radius: 0 6px 6px 0;
      cursor: pointer;
    }
    /* The label runs from the bottom of the tab to the top, as it does on the spine of a book. */
    .tab__text {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      white-space: nowrap;
    }
    .tab:hover {
      color: var(--smoke-yellow);
      border-color: var(--smoke-yellow);
    }
    .tab.is-on {
      color: var(--ink);
      background: var(--brass);
      border-color: var(--brass);
    }
    .tab:focus-visible {
      outline: 2px solid var(--smoke-yellow);
      outline-offset: 2px;
    }
  `,
})
export class LeftTabs {
  readonly tabs = input.required<readonly LeftTab[]>();
  /** The id of the tab that is open, or `null` when none is. */
  readonly active = model<string | null>(null);
  /** The id of the panel the tabs open, for the tabs' `aria-controls`. */
  readonly panelId = input('left-flyout');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The tab that can be reached with Tab: the open one, or the first. */
  protected focusable(): number {
    return Math.max(0, this.tabs().findIndex((t) => t.id === this.active()));
  }

  /** A tab was pressed: it opens, or, if it is the open one, shuts. */
  protected choose(id: string): void {
    this.active.set(id === this.active() ? null : id);
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const last = this.tabs().length - 1;
    const to = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: last }[event.key as 'ArrowDown'];
    if (to === undefined) {
      return;
    }
    event.preventDefault();
    const target = Math.min(Math.max(to, 0), last);
    this.host.nativeElement.querySelectorAll<HTMLButtonElement>('[role=tab]')[target]?.focus();
  }
}
