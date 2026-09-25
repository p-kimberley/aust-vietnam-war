import { ChangeDetectionStrategy, Component, ElementRef, inject, input, model } from '@angular/core';
import { Icon, IconName } from './icon';

/** One tool in a rail at the edge of the map. More are added by listing them; nothing else needs to change here. */
export interface LeftTab {
  id: string;
  label: string;
  icon?: IconName;
  /** A count shown on the tab (how many filters are on, say); `null` or none shows nothing. */
  badge?: number | null;
}

/**
 * A rail of tabs at the top of the map's left or right edge, each with an icon and its label running along the tab. Choosing a
 * tab opens that tool in a panel that flies out beside the rail; choosing the open tab again shuts it. It follows the ARIA tabs
 * pattern for a vertical list: one tab is in the tab order, and the up and down arrows, Home and End move between them.
 */
@Component({
  selector: 'app-left-tabs',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-right]': "side() === 'right'" },
  template: `
    <div class="tabs" role="tablist" aria-orientation="vertical" [attr.aria-label]="label()">
      @for (tab of tabs(); track tab.id; let i = $index) {
        <button
          type="button"
          role="tab"
          class="tab"
          [class.is-on]="tab.id === active()"
          [id]="side() + '-tab-' + tab.id"
          [attr.aria-selected]="tab.id === active()"
          [attr.aria-controls]="panelId()"
          [attr.tabindex]="i === focusable() ? 0 : -1"
          (click)="choose(tab.id)"
          (keydown)="onKeydown($event, i)"
        >
          @if (tab.icon) {
            <app-icon class="tab__icon" [name]="tab.icon" />
          }
          <span class="tab__text">{{ tab.label }}</span>
          @if (tab.badge) {
            <span class="tab__badge" [attr.aria-label]="tab.badge + ' on'">{{ tab.badge }}</span>
          }
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
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.45rem;
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
    /* The label runs from the bottom of the tab to the top, as it does on the spine of a book; at the right, from the top down. */
    .tab__text {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      white-space: nowrap;
    }
    :host(.is-right) .tab__text {
      transform: none;
    }
    /* The icon comes before the label as it reads: below it at the left (read upwards), above it at the right (read downwards). */
    .tab {
      flex-direction: column-reverse;
    }
    :host(.is-right) .tab {
      flex-direction: column;
    }
    /* The icon turns with the label, so that its top is where the label's letters have theirs. */
    .tab__icon {
      margin: 0;
      transform: rotate(-90deg);
    }
    :host(.is-right) .tab__icon {
      transform: rotate(90deg);
    }
    /* So does the count, so that it reads along the tab with the label. */
    .tab__badge {
      transform: rotate(-90deg);
    }
    :host(.is-right) .tab__badge {
      transform: rotate(90deg);
    }
    .tab__badge {
      min-width: 1.2rem;
      padding: 0 0.25rem;
      color: var(--ink);
      font-family: var(--font-body);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0;
      line-height: 1.2rem;
      text-align: center;
      background: var(--smoke-yellow);
      border-radius: 0.6rem;
    }
    .tab.is-on .tab__badge {
      background: var(--paper);
    }
    :host(.is-right) .tab {
      border-right: 0;
      border-left: 1px solid var(--olive-500);
      border-radius: 6px 0 0 6px;
    }
    :host(.is-right) .tab:hover {
      border-color: var(--smoke-yellow);
    }
    :host(.is-right) .tab.is-on {
      border-color: var(--brass);
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
  /** The edge the rail sits on; tab ids are `<side>-tab-<id>`. */
  readonly side = input<'left' | 'right'>('left');
  /** The rail's name for a screen reader. */
  readonly label = input('Map tools');
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
