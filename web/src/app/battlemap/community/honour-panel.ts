import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { problemMessage } from '../../studio/studio-api';
import { CommunityService, HonourPerson, TributeView } from './community';
import { Icon } from '../icon';
import { LoadMore } from '../load-more';

/**
 * The person's entry on the Australian War Memorial's Roll of Honour: its people search, on the Roll of Honour, for their service
 * number, which finds just them (the Memorial's own record numbers are not on the nominal roll).
 */
export function awmRollOfHonourUrl(serviceNumber: string): string {
  return `https://www.awm.gov.au/advanced-search/people?roll=Roll%20of%20Honour&people_service_number=${encodeURIComponent(serviceNumber)}`;
}

/** A person on the honour roll: who they were, where they served, the incidents they are linked to, and the poppies left for them. */
@Component({
  selector: 'app-honour-panel',
  imports: [DatePipe, Icon, LoadMore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './community.css',
  styles: `
    :host {
      height: 100%;
    }
    .panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: color-mix(in srgb, var(--olive-900) 97%, transparent);
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--olive-500);
    }
    h2 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 1rem;
      color: var(--smoke-yellow);
    }
    h2:focus {
      outline: none;
    }
    .close {
      width: 2rem;
      height: 2rem;
      padding: 0;
      font-size: 1.4rem;
      line-height: 1;
    }
    .body {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem 0.75rem 1rem;
    }
    h3 {
      margin: 1rem 0 0.25rem;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--brass);
    }
    .portrait {
      float: right;
      width: 6rem;
      margin: 0 0 0.5rem 0.75rem;
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
    }
    /* The arrow out of the box after the words says the link leaves the site. */
    .awm app-icon {
      width: 0.9em;
      height: 0.9em;
      margin-inline: 0.3em 0;
      vertical-align: -0.1em;
    }
    .awm {
      margin: 0.6rem 0 0;
    }
    /* Each field's name above its value, so a value has the panel's width (less the portrait's) and is not squeezed into a column. */
    dl {
      margin: 0.5rem 0;
    }
    /* A small heading, a step below the sections' headings. */
    dt {
      margin-top: 0.55rem;
      font-family: var(--font-display);
      font-size: 0.68rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--khaki);
    }
    dt:first-child {
      margin-top: 0;
    }
    dd {
      margin: 0.05rem 0 0;
    }
    ul.tours,
    ul.incidents {
      margin: 0;
      padding-left: 1.1rem;
    }
    .poppy {
      display: inline-block;
      width: 0.8rem;
      height: 0.8rem;
      margin-right: 0.35rem;
      border-radius: 50%;
      background: radial-gradient(circle at 50% 50%, #1f2314 0 22%, var(--contact-red) 24%);
      vertical-align: middle;
    }
  `,
  template: `
    <section class="panel" aria-labelledby="honour-title">
      <header class="head">
        <h2 id="honour-title" #heading tabindex="-1">{{ person()?.name ?? 'Honour roll' }}</h2>
        @if (closable()) {
          <button type="button" class="close" aria-label="Close" (click)="closed.emit()">×</button>
        }
      </header>

      <div class="body">
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        } @else if (person(); as p) {
          @if (p.portraitUrl) {
            <img class="portrait" [src]="p.portraitUrl" [alt]="'Portrait of ' + p.name" />
          }
          <dl>
            <dt>Service number</dt><dd>{{ p.serviceNumber }}</dd>
            @if (p.rank) { <dt>Rank</dt><dd>{{ p.rank }}</dd> }
            @if (p.branch) { <dt>Corps</dt><dd>{{ p.branch }}</dd> }
            @if (p.birth) {
              <dt>Born</dt>
              <dd>{{ p.birth | date: 'd MMM y' }}{{ birthplace(p) ? ', ' + birthplace(p) : '' }}</dd>
            }
            @if (p.death) {
              <dt>Died</dt>
              <dd>{{ p.death | date: 'd MMM y' }}{{ p.ageAtDeath !== null ? ', aged ' + p.ageAtDeath : '' }}</dd>
            }
            @if (p.nationalService !== null) {
              <dt>Service</dt><dd>{{ p.nationalService ? 'National Service' : 'Regular Army' }}</dd>
            }
          </dl>
          <p class="awm">
            <a [href]="awmUrl(p.serviceNumber)" target="_blank" rel="noopener">Australian War Memorial Roll of Honour<app-icon name="external" /><span class="visually-hidden"> (opens in a new tab)</span></a>
          </p>

          @if (p.tours.length) {
            <h3>Service in Vietnam</h3>
            <ul class="tours">
              @for (t of p.tours; track $index) {
                <li>{{ t.unit || 'Unit not recorded' }}<span class="meta">{{ tourDates(t.start, t.end) }}</span></li>
              }
            </ul>
          }

          @if (p.incidents.length) {
            <h3>Incidents</h3>
            <ul class="incidents">
              @for (id of p.incidents; track id) {
                <li><button type="button" class="link" (click)="openIncident.emit(id)">Incident {{ id }}</button></li>
              }
            </ul>
          }

          <h3>Poppies ({{ tributes()?.total ?? p.tributes }})</h3>
          @if (message()) {
            <p class="error" role="alert">{{ message() }}</p>
          }
          @if (auth.isAuthenticated()) {
            <form (submit)="$event.preventDefault(); leave(note)">
              <label>Leave a poppy and a few words <textarea #note rows="3" maxlength="500" required></textarea></label>
              <div class="actions"><button type="submit" class="primary" [disabled]="busy()"><span class="poppy" aria-hidden="true"></span>Place a poppy</button></div>
            </form>
          } @else {
            <p class="hint"><button type="button" class="link" (click)="auth.login()">Sign in</button> to leave a poppy.</p>
          }
          @for (t of items(); track t.id) {
            <article class="card">
              <p class="body"><span class="poppy" aria-hidden="true"></span>{{ t.message || 'Laid a poppy.' }}</p>
              <p class="meta">{{ t.authorName }}, {{ t.createdUtc | date: 'd MMM y' }}</p>
              @if (t.canDelete) {
                <button type="button" class="link" (click)="remove(t)" [disabled]="busy()">Remove</button>
              }
            </article>
          } @empty {
            @if (tributes()) {
              <p class="empty">No one has left a poppy yet.</p>
            }
          }
          @if (more()) {
            <p class="hint loading-more" role="status" appLoadMore [busy]="busy()" (appLoadMore)="loadMore()">{{ busy() ? 'Loading more…' : '' }}</p>
          }
        } @else {
          <p class="hint" role="status">Loading…</p>
        }
      </div>
    </section>
  `,
})
export class HonourPanel {
  protected readonly awmUrl = awmRollOfHonourUrl;
  readonly serviceNumber = input.required<string>();
  readonly closed = output<void>();
  /** Whether the panel has its own close button; not where what holds it has one (the Nominal Roll's). */
  readonly closable = input(true);
  /** Opens one of this person's incidents on the map. */
  readonly openIncident = output<number>();

  protected readonly auth = inject(AuthService);
  private readonly api = inject(CommunityService);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly person = signal<HonourPerson | null>(null);
  protected readonly tributes = signal<{ total: number } | null>(null);
  protected readonly items = signal<TributeView[]>([]);
  protected readonly more = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly busy = signal(false);

  private page = 1;
  private latest = 0;

  constructor() {
    effect(() => {
      const sn = this.serviceNumber();
      void this.load(sn);
    });
    // Move focus into the panel when a person opens, as the incident panel does.
    effect(() => {
      this.person();
      this.heading()?.nativeElement.focus();
    });
  }

  protected birthplace(p: HonourPerson): string {
    return [p.birthPlace, p.birthState, p.birthCountry].filter((x): x is string => !!x).join(', ');
  }

  protected tourDates(start: string | null, end: string | null): string {
    return start || end ? ` (${start ?? '?'} to ${end ?? '?'})` : '';
  }

  private async load(serviceNumber: string): Promise<void> {
    const ticket = ++this.latest;
    this.person.set(null);
    this.items.set([]);
    this.tributes.set(null);
    this.error.set('');
    this.message.set('');
    this.page = 1;
    try {
      const [person, tributes] = await Promise.all([this.api.person(serviceNumber), this.api.tributes(serviceNumber, 1)]);
      if (ticket === this.latest) {
        this.person.set(person);
        this.items.set(tributes.items);
        this.tributes.set({ total: tributes.total });
        this.more.set(tributes.items.length < tributes.total);
      }
    } catch (e) {
      if (ticket === this.latest) {
        this.error.set(problemMessage(e, 'This person could not be loaded.'));
      }
    }
  }

  protected async loadMore(): Promise<void> {
    this.busy.set(true);
    try {
      const next = await this.api.tributes(this.serviceNumber(), this.page + 1);
      this.page++;
      this.items.update((list) => [...list, ...next.items]);
      this.more.set(this.items().length < next.total);
    } catch (e) {
      // Stop asking as the reader scrolls, or a failing request would be tried again and again.
      this.more.set(false);
      this.message.set(problemMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async leave(box: HTMLTextAreaElement): Promise<void> {
    this.busy.set(true);
    this.message.set('');
    try {
      const made = await this.api.leaveTribute(this.serviceNumber(), box.value);
      box.value = '';
      this.items.update((list) => [made, ...list]);
      this.tributes.update((t) => (t ? { total: t.total + 1 } : t));
    } catch (e) {
      this.message.set(problemMessage(e, 'The poppy could not be placed.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(t: TributeView): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.deleteTribute(t.id);
      this.items.update((list) => list.filter((x) => x.id !== t.id));
      this.tributes.update((x) => (x ? { total: Math.max(0, x.total - 1) } : x));
    } catch (e) {
      this.message.set(problemMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
