import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { BasemapIcon } from './basemap-icon';

let nextId = 0;

/**
 * A drop-down list of basemaps, each with a small picture of its look. A native select cannot show pictures in its list,
 * so this is a select-only combobox built to the same pattern: the button announces as a combobox with a listbox, and works
 * from the keyboard (arrows, Home, End, Enter, Space, Escape, and the first letter of a name).
 */
@Component({
  selector: 'app-basemap-picker',
  imports: [BasemapIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'closeOnOutsideClick($event)' },
  template: `
    <button
      type="button"
      class="pick"
      role="combobox"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="listId"
      [attr.aria-labelledby]="labelledBy() || null"
      [attr.aria-activedescendant]="open() ? optionId(active()) : null"
      (click)="toggle()"
      (keydown)="onKeydown($event)"
    >
      @if (selected(); as s) {
        <app-basemap-icon [id]="s.id" />
        <span class="pick__name">{{ s.name }}</span>
      }
      <span class="pick__arrow" aria-hidden="true"></span>
    </button>
    @if (open()) {
      <ul class="list" role="listbox" [id]="listId" [attr.aria-labelledby]="labelledBy() || null">
        @for (o of options(); track o.id; let i = $index) {
          <li
            role="option"
            [id]="optionId(i)"
            [attr.aria-selected]="o.id === selected()?.id"
            [class.is-active]="i === active()"
            (click)="choose(o.id)"
            (mousemove)="active.set(i)"
          >
            <app-basemap-icon [id]="o.id" />
            <span>{{ o.name }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }
    .pick {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.6rem;
      width: 100%;
      min-height: 2.6rem;
      padding: 0.25rem 2rem 0.25rem 0.35rem;
      color: var(--ink);
      font: inherit;
      text-align: left;
      background: var(--field);
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
      cursor: pointer;
    }
    .pick:hover {
      border-color: var(--smoke-yellow);
    }
    /* The same arrow as the other drop-downs: two triangles meeting, in the text colour. */
    .pick__arrow {
      position: absolute;
      top: 50%;
      right: 0.65rem;
      width: 0.7rem;
      height: 0.35rem;
      margin-top: -0.175rem;
      background-image: linear-gradient(45deg, transparent 50%, currentcolor 50%), linear-gradient(135deg, currentcolor 50%, transparent 50%);
      background-position:
        0 0,
        0.35rem 0;
      background-size: 0.35rem 0.35rem;
      background-repeat: no-repeat;
    }
    .list {
      position: absolute;
      z-index: 5;
      left: 0;
      right: 0;
      margin: 0.2rem 0 0;
      padding: 0.2rem;
      color: var(--ink);
      list-style: none;
      background: var(--surface-raised);
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
      box-shadow: 0 6px 18px rgb(20 22 10 / 0.4);
    }
    .list li {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.25rem 0.35rem;
      border-radius: 2px;
      cursor: pointer;
    }
    .list li.is-active {
      background: var(--khaki);
    }
    /* The basemap in use carries a brass bar, so it is clear which one it is whatever the pointer is over. */
    .list li[aria-selected='true'] {
      font-weight: 700;
      box-shadow: inset 3px 0 0 var(--brass);
    }
    :focus-visible {
      outline: 2px solid var(--smoke-yellow);
      outline-offset: 2px;
    }
  `,
})
export class BasemapPicker {
  readonly options = input.required<readonly { id: string; name: string }[]>();
  /** The id of the basemap in use. */
  readonly value = input<string | null | undefined>(null);
  /** The id of the element that names this control. */
  readonly labelledBy = input('');
  readonly picked = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly listId = `basemap-list-${nextId++}`;
  protected readonly open = signal(false);
  /** The option the keyboard or pointer is on, which is chosen by Enter. */
  protected readonly active = signal(0);
  protected readonly selected = computed(() => this.options().find((o) => o.id === this.value()) ?? this.options()[0]);

  protected optionId(index: number): string {
    return `${this.listId}-${index}`;
  }

  protected toggle(): void {
    this.open() ? this.open.set(false) : this.show();
  }

  private show(): void {
    this.active.set(Math.max(0, this.options().findIndex((o) => o.id === this.selected()?.id)));
    this.open.set(true);
  }

  protected choose(id: string): void {
    this.open.set(false);
    this.picked.emit(id);
  }

  protected closeOnOutsideClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    const last = this.options().length - 1;
    /** Moves the highlight, which first opens the list on the basemap in use if it was closed. */
    const go = (to: (current: number) => number, opensOnly = false) => {
      event.preventDefault();
      if (!this.open()) {
        this.show();
        if (opensOnly) {
          return;
        }
      }
      this.active.set(Math.min(Math.max(to(this.active()), 0), last));
    };
    switch (event.key) {
      case 'ArrowDown':
        return go((a) => a + 1, true);
      case 'ArrowUp':
        return go((a) => a - 1, true);
      case 'Home':
        return go(() => 0);
      case 'End':
        return go(() => last);
      case 'Enter':
      case ' ':
        event.preventDefault();
        return this.open() ? this.choose(this.options()[this.active()].id) : this.show();
      case 'Escape':
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.open.set(false);
        }
        return;
      case 'Tab':
        this.open.set(false);
        return;
      default:
        // Typing the first letter of a name goes to the next basemap that starts with it.
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const letter = event.key.toLowerCase();
          const options = this.options();
          const from = this.open() ? this.active() : Math.max(0, options.findIndex((o) => o.id === this.selected()?.id));
          const found = [...options.keys()].map((n) => (from + 1 + n) % options.length).find((i) => options[i].name.toLowerCase().startsWith(letter));
          if (found !== undefined) {
            go(() => found);
          }
        }
    }
  }
}
