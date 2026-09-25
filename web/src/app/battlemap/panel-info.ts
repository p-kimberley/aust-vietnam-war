import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal } from '@angular/core';
import { Icon } from './icon';

let nextId = 0;

/**
 * An info button beside a panel's heading (whose header must be positioned, as the words hang across it): pressed, it shows a line or two on what the panel is for, just below. Pressed again,
 * Escape or a click anywhere else puts it away. It is a disclosure (the button says whether the words are showing), not a hover
 * tooltip, so it works the same with a finger or the keyboard.
 */
@Component({
  selector: 'app-panel-info',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'outside($event)',
    '(keydown.escape)': 'close(true)',
  },
  template: `
    <button
      #button
      type="button"
      class="info"
      [attr.aria-label]="'About ' + subject()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="id"
      (click)="open.set(!open())"
    >
      <app-icon name="info" />
    </button>
    @if (open()) {
      <p class="info__text" [id]="id" role="note">{{ text() }}</p>
    }
  `,
  styles: `
    /* The words hang across the header the button is in (which is positioned), so they fit whatever width the panel has. */
    :host {
      display: inline-flex;
    }
    .info {
      display: inline-grid;
      place-items: center;
      width: 1.6rem;
      height: 1.6rem;
      padding: 0;
      color: var(--khaki);
      background: none;
      border: 0;
      border-radius: 50%;
      cursor: pointer;
    }
    .info:hover,
    .info[aria-expanded='true'] {
      color: var(--smoke-yellow);
    }
    .info:focus-visible {
      outline: 2px solid var(--smoke-yellow);
      outline-offset: 1px;
    }
    .info app-icon {
      margin: 0;
    }
    .info__text {
      position: absolute;
      z-index: 5;
      top: calc(100% + 0.35rem);
      right: 0.5rem;
      left: 0.5rem;
      margin: 0;
      padding: 0.5rem 0.65rem;
      color: var(--paper);
      font-family: var(--font-body);
      font-size: 0.85rem;
      font-weight: 400;
      letter-spacing: 0;
      line-height: 1.4;
      text-transform: none;
      background: var(--olive-900);
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
      box-shadow: 0 4px 14px rgb(0 0 0 / 0.4);
    }
  `,
})
export class PanelInfo {
  /** What the panel is, as in "About the charts": the button's name for a screen reader. */
  readonly subject = input.required<string>();
  /** A line or two on what the panel is for. */
  readonly text = input.required<string>();

  protected readonly open = signal(false);
  protected readonly id = `panel-info-${nextId++}`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected close(refocus: boolean): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    if (refocus) {
      this.host.nativeElement.querySelector<HTMLButtonElement>('.info')?.focus();
    }
  }

  protected outside(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.close(false);
    }
  }
}
