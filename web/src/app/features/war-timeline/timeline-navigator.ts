import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, afterNextRender, inject, input, signal } from '@angular/core';
import { OperationFacts, PhaseView, daySpan, phaseColour } from './timeline-data';
import { PHASE_OPENING_MS } from './timeline-phase';
import { TimelineState } from './timeline-state';

/** How far down the window a phase or operation must have come to be the one being read: just under the sticky view controls. */
const READING_LINE = 0.15;

/**
 * A strip down the right-hand edge of the page, one line for each phase (long, in its colour) and one for each of its operations
 * (short), in the war's order, the phase and operation being read picked out as the reader scrolls. Pointed at, a line says what
 * it is; chosen, it opens its phase and brings it (or the operation) into view.
 */
@Component({
  selector: 'app-timeline-navigator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'onScroll()', '(window:resize)': 'onScroll()' },
  template: `
    <nav aria-label="Phases and operations">
      <ol>
        @for (v of views(); track v.phase.slug) {
          <li class="phase" [class.is-current]="current().phase === v.phase.slug" [style.--c]="colour(v.index)">
            <button
              type="button"
              class="tick tick--phase"
              [attr.aria-current]="current().phase === v.phase.slug ? 'location' : null"
              (click)="go(v.phase.slug)"
            >
              <span class="label"><strong>{{ v.phase.title }}</strong> {{ span(v.phase.from, v.phase.to) }}</span>
            </button>
            @if (operationsOf(v); as ops) {
              @if (ops.length) {
                <ol>
                  @for (o of ops; track o.slug) {
                    <li>
                      <button
                        type="button"
                        class="tick tick--op"
                        [class.is-current]="current().operation === o.slug"
                        [attr.aria-current]="current().operation === o.slug ? 'location' : null"
                        (click)="go(v.phase.slug, o.slug)"
                      >
                        <span class="label"><strong>Operation {{ o.name }}</strong> {{ span(o.from, o.to) }}</span>
                      </button>
                    </li>
                  }
                </ol>
              }
            }
          </li>
        }
      </ol>
    </nav>
  `,
  styles: `
    :host {
      position: fixed;
      z-index: 3;
      top: 50%;
      right: 0.5rem;
      transform: translateY(-50%);
    }
    ol {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    nav > ol {
      --row: min(7px, calc(76vh / 96));
    }
    .phase {
      padding: calc(var(--row) * 0.2) 0;
      border-radius: var(--radius);
      transition:
        background-color 0.2s,
        box-shadow 0.2s;
    }
    .phase:not(:first-child) {
      margin-top: calc(var(--row) * 0.4);
    }
    /* The phase being read: its whole range shaded in its colour, from its line to its last operation's, its edge marked. */
    .phase.is-current {
      background: color-mix(in srgb, var(--c) 16%, transparent);
      box-shadow: inset -3px 0 0 var(--c);
    }
    /* Each line is a button the height of a row, so it can be pointed at; the line itself is drawn at its right. */
    .tick {
      position: relative;
      display: block;
      width: 2.4rem;
      height: var(--row);
      padding: 0;
      background: none;
      border: 0;
      cursor: pointer;
    }
    .tick::before {
      content: '';
      position: absolute;
      top: 50%;
      right: 6px;
      width: 10px;
      height: 2px;
      background: color-mix(in srgb, var(--text-muted) 55%, transparent);
      border-radius: 1px;
      transform: translateY(-50%);
      transition:
        width 0.15s,
        height 0.15s,
        background-color 0.15s;
    }
    .tick--phase::before {
      width: 24px;
      height: 3px;
      background: var(--c);
    }
    /* Pointed at: longer, in the phase's colour. */
    .tick--op:hover::before,
    .tick--op:focus-visible::before {
      width: 18px;
      background: var(--c);
    }
    .tick--phase:hover::before,
    .tick--phase:focus-visible::before {
      width: 32px;
    }
    /* The operation being read: thicker and longer, in full colour with a soft halo, so it is found at a glance. */
    .tick--op.is-current::before {
      width: 24px;
      height: 4px;
      background: var(--c);
      border-radius: 2px;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 25%, transparent);
    }
    .tick:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 1px;
    }
    /* What a line is, beside it, while it is pointed at or has the keyboard. */
    .label {
      position: absolute;
      top: 50%;
      right: calc(100% + 0.4rem);
      padding: 0.3rem 0.55rem;
      font-size: 0.8rem;
      line-height: 1.3;
      white-space: nowrap;
      color: var(--paper);
      background: var(--olive-900);
      border-left: 3px solid var(--c);
      border-radius: var(--radius);
      box-shadow: 0 3px 10px rgb(0 0 0 / 0.25);
      opacity: 0;
      pointer-events: none;
      transform: translate(4px, -50%);
      transition:
        opacity 0.12s,
        transform 0.12s;
    }
    .label strong {
      display: block;
      font-weight: 600;
    }
    .tick:hover .label,
    .tick:focus-visible .label {
      opacity: 1;
      transform: translate(0, -50%);
    }
    @media (max-width: 40rem) {
      :host {
        display: none;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .tick::before,
      .label {
        transition: none;
      }
    }
  `,
})
export class TimelineNavigator {
  /** The phases shown (with those the unit chosen took no part in left out). */
  readonly views = input.required<readonly PhaseView[]>();

  private readonly state = inject(TimelineState);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  /** The phase and the operation being read: the last of each whose top has passed the reading line. */
  protected readonly current = signal<{ phase: string | null; operation: string | null }>({ phase: null, operation: null });
  private frame = 0;

  protected readonly span = daySpan;
  protected readonly colour = phaseColour;

  protected operationsOf(v: PhaseView): OperationFacts[] {
    const shows = this.state.shows();
    return v.entries.flatMap((e) => (e.kind === 'operation' && shows(e.operation.units) ? [e.operation] : []));
  }

  constructor() {
    afterNextRender(() => this.measure(), { injector: this.injector });
  }

  /**
   * Opens the phase and brings it, or the operation in it, into view. A phase that was shut grows open first, moving what is in it
   * as it does, so the page waits for that before it moves (at once where the reader asks for less motion, as nothing then grows).
   */
  protected go(phase: string, operation?: string): void {
    const wasOpen = this.state.phaseOpen(phase);
    this.state.open(phase);
    const still = this.reducedMotion();
    const bring = () =>
      this.document.getElementById(operation ? `op-${operation}` : phase)?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    afterNextRender(() => (wasOpen || still ? bring() : setTimeout(bring, PHASE_OPENING_MS)), { injector: this.injector });
  }

  protected onScroll(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  private measure(): void {
    const line = (this.document.defaultView?.innerHeight ?? 0) * READING_LINE;
    const passed = (id: string) => {
      const el = this.document.getElementById(id);
      return !!el && el.getBoundingClientRect().top <= line;
    };
    const phase = [...this.views()].reverse().find((v) => passed(v.phase.slug)) ?? null;
    const operation = phase ? [...this.operationsOf(phase)].reverse().find((o) => passed(`op-${o.slug}`)) ?? null : null;
    const next = { phase: phase?.phase.slug ?? null, operation: operation?.slug ?? null };
    const now = this.current();
    if (now.phase !== next.phase || now.operation !== next.operation) this.current.set(next);
  }

  private reducedMotion(): boolean {
    return !!this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }
}
