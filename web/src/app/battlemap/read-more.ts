import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, afterRenderEffect, inject, input, linkedSignal, signal, viewChild } from '@angular/core';
import { Icon } from './icon';

let nextId = 0;

/**
 * A long piece of text shown as its first few lines, fading out, with Read more under it for the rest. The text opens and closes
 * smoothly (at once for those who ask for less motion). New text starts closed. The text's look (spacing, line breaks, line height)
 * comes from the host, which the text inherits.
 */
@Component({
  selector: 'app-read-more',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-clamped]': '!expanded()', '[style.--lines]': 'lines()' },
  template: `
    <div #body class="rm__text" [id]="textId()" [class.is-clamped]="!expanded()">{{ text() }}</div>
    @if (clamped() || expanded()) {
      <button type="button" class="rm__toggle" [attr.aria-controls]="textId()" [attr.aria-expanded]="expanded()" (click)="toggle()">
        {{ expanded() ? 'Read less' : 'Read more' }}<app-icon [name]="expanded() ? 'chevron-up' : 'chevron-down'" />
      </button>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .rm__text {
      overflow: hidden;
    }
    /* The first lines, the last of them fading out. */
    .rm__text.is-clamped {
      max-height: calc(var(--lines) * 1lh);
      mask-image: linear-gradient(to bottom, #000 calc(100% - 1.5lh), transparent);
    }
    /* Across the width of the text, its words and arrow centred; the row shades under the pointer. */
    .rm__toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      margin-top: 0.25rem;
      padding: 0.25rem 0.5rem;
      font: inherit;
      white-space: nowrap;
      color: var(--smoke-yellow);
      background: none;
      border: 0;
      border-radius: var(--radius);
      cursor: pointer;
      transition: background-color 0.15s;
    }
    .rm__toggle:hover {
      background: color-mix(in srgb, var(--smoke-yellow) 10%, transparent);
    }
    .rm__toggle:focus-visible {
      outline: 2px solid var(--smoke-yellow);
      outline-offset: 2px;
    }
    .rm__toggle app-icon {
      margin-inline: 0.25em 0;
    }
  `,
})
export class ReadMore {
  readonly text = input.required<string>();
  /** How many lines show before Read more. */
  readonly lines = input(5);
  /** The text's id, for something else to point at it (as a dialog's description). */
  readonly textId = input(`read-more-${nextId++}`);
  /** The whole text is showing; new text starts with only its first lines. */
  protected readonly expanded = linkedSignal({ source: this.text, computation: () => false });
  /** The text runs past its first lines, so there is more to read. */
  protected readonly clamped = signal(false);
  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');
  private readonly injector = inject(Injector);

  constructor() {
    // Whether there is more is seen once the text is on the page.
    afterRenderEffect(() => {
      const el = this.body().nativeElement;
      this.text();
      if (!this.expanded()) this.clamped.set(el.scrollHeight > el.clientHeight + 1);
    });
  }

  /** Opens or closes the text, easing its height from where it was to where it lands. */
  protected toggle() {
    const el = this.body().nativeElement;
    const from = el.clientHeight;
    this.expanded.set(!this.expanded());
    afterNextRender(
      () => {
        const to = el.clientHeight;
        const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (from === to || still || typeof el.animate !== 'function') return;
        el.animate([{ maxHeight: `${from}px` }, { maxHeight: `${to}px` }], { duration: 250, easing: 'ease-in-out' });
      },
      { injector: this.injector },
    );
  }
}
