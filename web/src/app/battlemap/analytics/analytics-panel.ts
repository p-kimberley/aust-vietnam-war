import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import {
  AnalyticsService,
  ChartGroup,
  ChartInfo,
  ChartResult,
  GROUP_LABEL,
  chartOption,
  chartTable,
  isEmpty,
} from './analytics';
import { EChart } from './echart';

/** How long the panel waits after the filters change before asking for new figures, so dragging a slider is not a flood of requests. */
export const REFRESH_DELAY_MS = 300;

/** The most table rows shown; a daily chart has thousands, and the full figures are a lot to read on a page. */
const MAX_TABLE_ROWS = 400;

const GROUPS: ChartGroup[] = ['Casualties', 'Frequency', 'Weapons', 'Personnel'];

/**
 * Charts about the contacts on the map and the people on the nominal roll. Contact charts are drawn from the contacts the
 * map is showing, so they follow its filters; personnel charts are always about everyone.
 */
@Component({
  selector: 'app-analytics-panel',
  imports: [EChart, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ap" aria-labelledby="ap-title">
      <header class="ap__head">
        <h2 id="ap-title">Charts</h2>
        <button type="button" class="ap__close" (click)="closed.emit()" aria-label="Close charts">×</button>
      </header>

      @if (charts().length) {
        <label class="ap__pick">
          Chart
          <select [value]="selected()" (change)="select($any($event.target).value)">
            @for (g of groups(); track g.group) {
              <optgroup [label]="g.label">
                @for (c of g.charts; track c.id) {
                  <option [value]="c.id" [selected]="c.id === selected()">{{ c.title }}</option>
                }
              </optgroup>
            }
          </select>
        </label>
      } @else if (listError()) {
        <p class="ap__error" role="alert">The list of charts could not be loaded.</p>
      }

      @if (info(); as i) {
        <p class="ap__about">{{ i.description }}</p>
        <p class="ap__scope data">
          @if (!i.usesFilter) {
            {{ result()?.rows | number }} people on the nominal roll, with the dates this chart needs. The map's filters do not change it.
          } @else if (filtered()) {
            {{ result()?.rows | number }} filtered contacts.
          } @else {
            All {{ result()?.rows | number }} contacts.
          }
        </p>
      }

      <div class="ap__chart" aria-live="polite">
        @if (error()) {
          <p class="ap__error" role="alert">{{ error() }}</p>
        } @else if (result(); as r) {
          @if (empty()) {
            <p class="ap__empty">Nothing to chart for these contacts. Widen the filters to see more.</p>
          } @else {
            <app-echart [option]="option()!" />
          }
        } @else {
          <p class="data">Loading…</p>
        }
        @if (loading() && result()) {
          <span class="ap__busy data">Updating…</span>
        }
      </div>

      @if (result()?.note; as note) {
        <p class="ap__note">{{ note }}</p>
      }

      @if (result() && !empty()) {
        <details class="ap__table" (toggle)="tableOpen.set($any($event.target).open)">
          <summary>Show the figures as a table</summary>
          @if (tableOpen()) {
            @if (table(); as t) {
              <div class="ap__scroll">
                <table>
                  <thead>
                    <tr>
                      @for (c of t.columns; track $index) {
                        <th scope="col">{{ c }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of t.rows; track $index) {
                      <tr>
                        @for (cell of row; track $index) {
                          @if ($first) {
                            <th scope="row">{{ cell }}</th>
                          } @else {
                            <td>{{ cell }}</td>
                          }
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              @if (t.truncated) {
                <p class="ap__note">Showing the first {{ t.rows.length | number }} rows.</p>
              }
            }
          }
        </details>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .ap {
      display: grid;
      gap: 0.5rem;
      padding: 0.75rem 1rem 1rem;
      background: rgb(31 35 20 / 0.96);
      color: var(--paper);
      border: 1px solid var(--olive-500);
      border-top: 3px solid var(--brass);
      max-height: 100%;
      overflow-y: auto;
    }
    .ap__head {
      display: flex;
      align-items: center;
    }
    .ap__head h2 {
      flex: 1;
      margin: 0;
      font-size: 1.1rem;
      color: var(--smoke-yellow);
    }
    .ap__close {
      background: none;
      border: 0;
      color: var(--khaki);
      font-size: 1.5rem;
      line-height: 1;
      cursor: pointer;
    }
    .ap__pick {
      display: grid;
      gap: 0.2rem;
      font-size: 0.85rem;
      color: var(--khaki);
    }
    select {
      background-color: var(--olive-700);
      color: var(--paper);
    }
    .ap__about,
    .ap__note {
      margin: 0;
      font-size: 0.9rem;
      color: var(--khaki);
    }
    .ap__scope {
      margin: 0;
      font-size: 0.85rem;
      color: var(--smoke-yellow);
    }
    .ap__chart {
      position: relative;
      height: clamp(15rem, 40dvh, 26rem);
    }
    .ap__busy {
      position: absolute;
      top: 0;
      right: 0.25rem;
      font-size: 0.8rem;
      color: var(--khaki);
    }
    .ap__error {
      color: var(--contact-red-bright);
    }
    .ap__empty {
      display: grid;
      place-items: center;
      height: 100%;
      margin: 0;
      color: var(--khaki);
      text-align: center;
    }
    .ap__table summary {
      cursor: pointer;
      color: var(--khaki);
      font-size: 0.9rem;
    }
    .ap__scroll {
      max-height: 16rem;
      overflow: auto;
      margin-top: 0.4rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    th,
    td {
      padding: 0.2rem 0.5rem;
      border-bottom: 1px solid var(--olive-700);
      text-align: right;
      white-space: nowrap;
    }
    th:first-child,
    thead th {
      text-align: left;
      position: sticky;
      top: 0;
      background: var(--olive-900);
    }
  `,
})
export class AnalyticsPanel implements OnDestroy {
  /** The ids of the contacts the map is showing. */
  readonly ids = input<readonly number[]>([]);
  /** Whether any filter is on. When none is, the charts use every contact and no ids are sent. */
  readonly filtered = input(false);
  readonly closed = output<void>();

  private readonly service = inject(AnalyticsService);

  protected readonly charts = signal<ChartInfo[]>([]);
  protected readonly listError = signal(false);
  protected readonly selected = signal('');
  protected readonly result = signal<ChartResult | null>(null);
  protected readonly error = signal('');
  protected readonly loading = signal(false);
  protected readonly tableOpen = signal(false);

  protected readonly groups = computed(() =>
    GROUPS.map((group) => ({ group, label: GROUP_LABEL[group], charts: this.charts().filter((c) => c.group === group) })).filter((g) => g.charts.length),
  );
  protected readonly info = computed(() => this.charts().find((c) => c.id === this.selected()) ?? null);
  protected readonly empty = computed(() => {
    const r = this.result();
    return r ? isEmpty(r) : false;
  });
  protected readonly option = computed(() => {
    const r = this.result();
    return r && !isEmpty(r) ? chartOption(r) : null;
  });
  protected readonly table = computed(() => {
    const r = this.result();
    if (!r || !this.tableOpen()) {
      return null;
    }
    const full = chartTable(r);
    return { columns: full.columns, rows: full.rows.slice(0, MAX_TABLE_ROWS), truncated: full.rows.length > MAX_TABLE_ROWS };
  });

  private timer?: ReturnType<typeof setTimeout>;
  private ticket = 0;

  constructor() {
    this.service.charts().then(
      (list) => {
        this.charts.set(list);
        this.selected.update((current) => current || list[0]?.id || '');
      },
      () => this.listError.set(true),
    );

    // Ask again whenever the chart or the contacts on the map change. Picking a chart is answered at once; a change of
    // filters waits a moment, in case another follows straight away.
    let lastId = '';
    effect(() => {
      const id = this.selected();
      const ids = this.filtered() ? this.ids() : null;
      const usesFilter = untracked(() => this.info()?.usesFilter ?? true);
      if (!id) {
        return;
      }
      clearTimeout(this.timer);
      const delay = id !== lastId || !usesFilter ? 0 : REFRESH_DELAY_MS;
      lastId = id;
      this.timer = setTimeout(() => void this.load(id, usesFilter ? ids : null), delay);
    });
  }

  protected select(id: string): void {
    this.selected.set(id);
    this.result.set(null);
    this.tableOpen.set(false);
  }

  private async load(id: string, ids: readonly number[] | null): Promise<void> {
    const ticket = ++this.ticket;                      // an answer to an older question is thrown away
    this.loading.set(true);
    try {
      const result = await this.service.draw(id, ids);
      if (ticket === this.ticket) {
        this.result.set(result);
        this.error.set('');
      }
    } catch {
      if (ticket === this.ticket) {
        this.error.set('This chart could not be drawn. Please try again shortly.');
      }
    } finally {
      if (ticket === this.ticket) {
        this.loading.set(false);
      }
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }
}
