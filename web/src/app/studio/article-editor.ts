import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CmsBody } from '../content/cms-body';
import { AuthService } from '../core/auth.service';
import { MediaLibrary } from './media-library';
import { RichText } from './rich-text';
import {
  ArticleEdit,
  ArticleInput,
  ArticleRow,
  ArticleStatus,
  Category,
  ContentKind,
  MediaView,
  RevisionDetail,
  RevisionSummary,
  STATUS_LABEL,
  StudioApi,
  isConflict,
  problemMessage,
} from './studio-api';

type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict';

export const AUTOSAVE_MS = 2500;

const ACTION_LABEL: Record<ArticleStatus, (from: ArticleStatus) => string> = {
  Draft: (from) => (from === 'InReview' ? 'Return to draft' : 'Back to draft'),
  InReview: () => 'Submit for review',
  Scheduled: () => 'Schedule…',
  Published: () => 'Publish',
  Archived: () => 'Archive',
};

/** Two-digit padding for the value of a datetime-local input. */
const two = (n: number) => String(n).padStart(2, '0');

/** The local date and time, a day from now on the hour, in the form a datetime-local input takes. */
export function defaultScheduleValue(now = new Date()): string {
  const d = new Date(now.getTime() + 24 * 3600 * 1000);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:00`;
}

/**
 * Writes and manages one article or page: text, details, workflow, revisions. It saves by itself a few seconds after
 * typing stops. What the server returns after a save (its version, the address it chose, what may happen next) is kept,
 * but the text on screen is left alone so the cursor never jumps.
 */
@Component({
  selector: 'app-article-editor',
  imports: [RichText, MediaLibrary, CmsBody, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loadError()) {
      <p class="error" role="alert">{{ loadError() }} <a routerLink="/studio/articles">Back to the list</a></p>
    } @else if (ready()) {
      <header class="top">
        <a routerLink="/studio/articles" class="back">← All items</a>
        <h1>{{ isPage() ? 'Page' : 'Article' }}</h1>
        @if (item(); as it) {
          <span class="status" [attr.data-status]="it.status">{{ statusLabel(it.status) }}</span>
        }
        <span class="grow"></span>
        <span class="saved" role="status" aria-live="polite" [attr.data-state]="saveState()">{{ saveText() }}</span>
        @if (canEdit()) {
          <button type="button" class="btn btn--quiet" (click)="save()" [disabled]="saveState() === 'saving'">Save now</button>
        }
      </header>

      @if (message()) {
        <p class="banner" [class.is-error]="saveState() === 'error' || saveState() === 'conflict'" role="alert">
          {{ message() }}
          @if (saveState() === 'conflict') {
            <button type="button" class="btn btn--quiet" (click)="reload()">Load the latest (discard my changes)</button>
          }
        </p>
      }

      <div class="layout">
        <main class="main">
          <label class="title">
            <span class="visually-hidden">Title</span>
            <input type="text" placeholder="Title" [value]="title()" [disabled]="!canEdit()" maxlength="300" (input)="set(title, $any($event.target).value)" />
          </label>

          @if (previewing()) {
            <article class="preview">
              <h2>{{ item()?.title }}</h2>
              <app-cms-body [html]="item()?.bodyHtml ?? ''" />
            </article>
          } @else {
            <app-rich-text #rt [html]="body()" [disabled]="!canEdit()" (changed)="set(body, $event)" (pickImage)="picker.set('body')" />
          }
        </main>

        <aside class="side" aria-label="Details">
          <section class="panel">
            <h2>Publishing</h2>
            @if (item(); as it) {
              <p class="meta data">
                By {{ it.authorName }}<br />
                Updated {{ it.updatedUtc | date: 'd MMM y, h:mm a' }}
                @if (it.publishedUtc) {
                  <br />Published {{ it.publishedUtc | date: 'd MMM y' }}
                }
                @if (it.scheduledUtc) {
                  <br />Goes live {{ it.scheduledUtc | date: 'd MMM y, h:mm a' }}
                }
              </p>
              <div class="actions">
                @for (target of it.transitions; track target) {
                  @if (target === 'Scheduled') {
                    <button type="button" class="btn btn--quiet" (click)="scheduling.set(!scheduling())">{{ actionLabel(target, it.status) }}</button>
                  } @else {
                    <button type="button" class="btn" [class.btn--quiet]="target === 'Archived' || target === 'Draft'" (click)="moveTo(target)" [disabled]="busy()">{{ actionLabel(target, it.status) }}</button>
                  }
                }
              </div>
              @if (scheduling()) {
                <form class="schedule" (submit)="$event.preventDefault(); schedule(when.value)">
                  <label>Go live at <input #when type="datetime-local" required [value]="defaultWhen" /></label>
                  <button type="submit" class="btn" [disabled]="busy()">Schedule</button>
                </form>
              }
              @if (it.kind === 'Article' && it.status === 'Published') {
                <p><a [href]="'/articles/' + it.slug" target="_blank" rel="noopener">View on the site</a></p>
              }
            } @else {
              <p class="meta">Saved automatically once it has a title. Publishing options appear after that.</p>
            }
          </section>

          <section class="panel">
            <h2>Details</h2>
            <label>Summary <textarea rows="3" maxlength="1000" [value]="excerpt()" [disabled]="!canEdit()" (input)="set(excerpt, $any($event.target).value)" placeholder="Shown in lists and link previews. Leave empty to use the start of the text."></textarea></label>
            @if (!isPage()) {
              <label>
                Category
                <select [value]="categoryId() ?? ''" [disabled]="!canEdit()" (change)="setCategory($any($event.target).value)">
                  <option value="">None</option>
                  @for (c of categories(); track c.id) {
                    <option [value]="c.id" [selected]="c.id === categoryId()">{{ c.name }}</option>
                  }
                </select>
              </label>
              @if (isEditor()) {
                <form class="inline" (submit)="$event.preventDefault(); addCategory(newCat)">
                  <input #newCat type="text" placeholder="New category" maxlength="100" aria-label="New category name" />
                  <button class="btn btn--quiet" type="submit">Add</button>
                </form>
              }
              <label>Tags <input type="text" [value]="tagsText()" [disabled]="!canEdit()" placeholder="Comma separated" (input)="set(tagsText, $any($event.target).value)" /></label>
            } @else {
              <label>
                Sits under
                <select [value]="parentId() ?? ''" [disabled]="!canEdit()" (change)="setParent($any($event.target).value)">
                  <option value="">Top level</option>
                  @for (p of parentChoices(); track p.id) {
                    <option [value]="p.id" [selected]="p.id === parentId()">{{ p.title }}</option>
                  }
                </select>
              </label>
              <label>Order among siblings <input type="number" [value]="sortOrder()" [disabled]="!canEdit()" (input)="set(sortOrder, +$any($event.target).value || 0)" /></label>
            }
            @if (isEditor()) {
              <label>Web address <input type="text" [value]="slug()" [disabled]="!canEdit()" placeholder="made from the title" pattern="[a-z0-9]+(-[a-z0-9]+)*" (input)="set(slug, $any($event.target).value)" /></label>
              @if (!isPage()) {
                <label class="check"><input type="checkbox" [checked]="feature()" [disabled]="!canEdit()" (change)="set(feature, $any($event.target).checked)" /> Feature on the home page</label>
              }
            }
          </section>

          @if (!isPage()) {
            <section class="panel">
              <h2>Main picture</h2>
              @if (featuredUrl()) {
                <img class="featured" [src]="featuredUrl()" alt="" />
              }
              <div class="actions">
                <button type="button" class="btn btn--quiet" [disabled]="!canEdit()" (click)="picker.set('featured')">{{ featuredUrl() ? 'Change' : 'Choose' }}</button>
                @if (featuredUrl()) {
                  <button type="button" class="btn btn--quiet" [disabled]="!canEdit()" (click)="clearFeatured()">Remove</button>
                }
              </div>
            </section>
          }

          <section class="panel">
            <h2>Search engines</h2>
            <label>Title <input type="text" maxlength="200" [value]="seoTitle()" [disabled]="!canEdit()" (input)="set(seoTitle, $any($event.target).value)" placeholder="Defaults to the title" /></label>
            <label>Description <textarea rows="2" maxlength="400" [value]="seoDescription()" [disabled]="!canEdit()" (input)="set(seoDescription, $any($event.target).value)" placeholder="Defaults to the summary"></textarea></label>
          </section>

          @if (item(); as it) {
            <section class="panel">
              <h2>Tools</h2>
              <div class="actions">
                <button type="button" class="btn btn--quiet" (click)="togglePreview()">{{ previewing() ? 'Back to editing' : 'Preview' }}</button>
                <button type="button" class="btn btn--quiet" (click)="toggleRevisions()">{{ showRevisions() ? 'Hide history' : 'History' }}</button>
                @if (canDelete()) {
                  <button type="button" class="btn btn--quiet danger" (click)="remove()">Delete…</button>
                }
              </div>
              @if (showRevisions()) {
                <ol class="revs">
                  @for (r of revisions(); track r.revisionNo) {
                    <li>
                      <button type="button" class="link" (click)="openRevision(r.revisionNo)">
                        Version {{ r.revisionNo }} · {{ r.createdUtc | date: 'd MMM, h:mm a' }} · {{ r.authorName }}
                      </button>
                    </li>
                  }
                </ol>
                @if (revision(); as rev) {
                  <div class="rev">
                    <h3>{{ rev.title }}</h3>
                    <app-cms-body [html]="rev.bodyHtml" />
                    @if (canEdit()) {
                      <button type="button" class="btn" (click)="restore(rev.revisionNo)" [disabled]="busy()">Restore this version</button>
                    }
                  </div>
                }
              }
            </section>
          }
        </aside>
      </div>

      @if (picker()) {
        <div class="modal" role="dialog" aria-modal="true" aria-label="Choose a picture" (keydown.escape)="picker.set(null)">
          <div class="modal__box">
            <button type="button" class="btn btn--quiet modal__close" (click)="picker.set(null)">Close</button>
            <app-media-library [picking]="true" (picked)="picked($event)" />
            @if (pickError()) {
              <p class="error" role="alert">{{ pickError() }}</p>
            }
          </div>
        </div>
      }
    } @else {
      <p class="data" aria-live="polite">Loading…</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .top h1 {
      margin: 0;
      font-size: 1.5rem;
    }
    .grow {
      flex: 1;
    }
    .saved {
      font-family: var(--font-data);
      font-size: 0.9rem;
    }
    .saved[data-state='error'],
    .saved[data-state='conflict'] {
      color: var(--contact-red);
    }
    .status {
      padding: 0.1rem 0.6rem;
      border-radius: 999px;
      background: var(--khaki);
      font-size: 0.85rem;
    }
    .status[data-status='Published'] {
      background: var(--olive-500);
      color: var(--paper);
    }
    .banner {
      padding: 0.6rem 0.9rem;
      background: #fffbe8;
      border: 1px solid var(--brass);
    }
    .banner.is-error,
    .error {
      color: var(--contact-red);
      border-color: var(--contact-red);
    }
    .layout {
      display: grid;
      gap: 1.5rem;
      grid-template-columns: minmax(0, 1fr) 20rem;
      align-items: start;
    }
    @media (max-width: 62rem) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    .title input {
      width: 100%;
      margin-bottom: 0.75rem;
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--rule);
      font-family: var(--font-display);
      font-size: 1.6rem;
    }
    .preview {
      padding: 1rem 1.25rem;
      background: #fff;
      border: 1px solid var(--rule);
    }
    .side {
      display: grid;
      gap: 1rem;
    }
    .panel {
      display: grid;
      gap: 0.6rem;
      padding: 0.9rem;
      background: var(--surface-raised);
      border: 1px solid var(--rule);
      border-top: 4px solid var(--brass);
    }
    .panel h2 {
      margin: 0;
      font-size: 1.05rem;
    }
    .panel label {
      display: grid;
      gap: 0.2rem;
      font-size: 0.9rem;
    }
    .panel .check {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .panel input:not([type='checkbox']),
    .panel textarea {
      padding: 0.4rem;
      font: inherit;
      width: 100%;
    }
    .panel select {
      width: 100%;
    }
    .meta {
      margin: 0;
      font-size: 0.9rem;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .inline {
      display: flex;
      gap: 0.4rem;
    }
    .schedule {
      display: grid;
      gap: 0.5rem;
    }
    .featured {
      width: 100%;
      height: auto;
    }
    .revs {
      margin: 0;
      padding-left: 1.2rem;
      max-height: 12rem;
      overflow-y: auto;
      font-size: 0.9rem;
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--enemy-rust);
      text-decoration: underline;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }
    .rev {
      padding: 0.6rem;
      background: #fff;
      border: 1px solid var(--rule);
      max-height: 20rem;
      overflow-y: auto;
    }
    .danger {
      color: var(--contact-red);
    }
    .modal {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: grid;
      place-items: center;
      background: rgb(31 35 20 / 0.7);
      padding: 1rem;
    }
    .modal__box {
      position: relative;
      width: min(60rem, 100%);
      max-height: 90dvh;
      overflow-y: auto;
      padding: 1.25rem;
      background: var(--paper);
      border: 2px solid var(--olive-900);
    }
    .modal__close {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
    }
  `,
})
export class ArticleEditor {
  /** `new`, or the numeric id (from the route). */
  readonly id = input<string>();
  /** `Page` when creating a page (from the query string). */
  readonly kind = input<string>();

  private readonly api = inject(StudioApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly richText = viewChild<RichText>('rt');

  protected readonly item = signal<ArticleEdit | null>(null);
  protected readonly ready = signal(false);
  protected readonly loadError = signal('');
  protected readonly saveState = signal<SaveState>('idle');
  protected readonly message = signal('');
  protected readonly busy = signal(false);
  protected readonly previewing = signal(false);
  protected readonly scheduling = signal(false);
  protected readonly picker = signal<'body' | 'featured' | null>(null);
  protected readonly pickError = signal('');
  protected readonly showRevisions = signal(false);
  protected readonly revisions = signal<RevisionSummary[]>([]);
  protected readonly revision = signal<RevisionDetail | null>(null);
  protected readonly categories = signal<Category[]>([]);
  protected readonly parentChoices = signal<ArticleRow[]>([]);
  protected readonly defaultWhen = defaultScheduleValue();

  // The form. Each is a signal so the template stays in step with what is typed.
  protected readonly title = signal('');
  protected readonly slug = signal('');
  protected readonly excerpt = signal('');
  protected readonly body = signal('');
  protected readonly categoryId = signal<number | null>(null);
  protected readonly featuredId = signal<number | null>(null);
  protected readonly featuredUrl = signal<string | null>(null);
  protected readonly feature = signal(false);
  protected readonly parentId = signal<number | null>(null);
  protected readonly sortOrder = signal(0);
  protected readonly seoTitle = signal('');
  protected readonly seoDescription = signal('');
  protected readonly tagsText = signal('');

  protected readonly isEditor = computed(() => this.auth.hasRole('editor'));
  protected readonly isPage = computed(() => (this.item()?.kind ?? (this.kind() === 'Page' ? 'Page' : 'Article')) === 'Page');
  protected readonly canEdit = computed(() => this.item()?.canEdit ?? true);
  protected readonly canDelete = computed(() => {
    const it = this.item();
    return !!it && it.canEdit && (it.status === 'Draft' || it.status === 'Archived');
  });
  protected readonly saveText = computed(() => {
    switch (this.saveState()) {
      case 'unsaved':
        return 'Unsaved changes';
      case 'saving':
        return 'Saving…';
      case 'saved':
        return 'All changes saved';
      case 'error':
        return 'Not saved';
      case 'conflict':
        return 'Not saved: out of date';
      default:
        return this.canEdit() ? '' : 'Read only';
    }
  });

  private timer?: ReturnType<typeof setTimeout>;
  private saving?: Promise<void>;
  private loaded?: string;

  constructor() {
    effect(() => {
      const id = this.id();
      if (id === undefined || id === this.loaded) {
        return;
      }
      this.loaded = id;
      void this.open(id);
    });
    void this.api.categories().then((c) => this.categories.set(c), () => undefined);
  }

  protected statusLabel = (s: ArticleStatus) => STATUS_LABEL[s];
  protected actionLabel = (target: ArticleStatus, from: ArticleStatus) => ACTION_LABEL[target](from);

  /** Warns before leaving with work that has not reached the server. */
  @HostListener('window:beforeunload', ['$event'])
  protected warn(event: BeforeUnloadEvent): void {
    if (['unsaved', 'saving', 'error', 'conflict'].includes(this.saveState())) {
      event.preventDefault();
    }
  }

  // ---------------------------------------------------------------- loading

  private async open(id: string): Promise<void> {
    this.ready.set(false);
    this.loadError.set('');
    this.saveState.set('idle');
    this.message.set('');
    if (id === 'new') {
      this.item.set(null);
      this.apply(null);
      this.ready.set(true);
    } else {
      try {
        const found = await this.api.get(Number(id));
        this.item.set(found);
        this.apply(found);
        this.ready.set(true);
      } catch (e) {
        this.loadError.set(problemMessage(e, 'That item could not be opened.'));
        return;
      }
    }
    if (this.isPage()) {
      void this.api.list({ kind: 'Page', pageSize: 100 }).then((p) => this.parentChoices.set(p.items.filter((x) => x.id !== this.item()?.id)), () => undefined);
    }
  }

  /** Copies an item into the form. Skipped for the text after an autosave, so the cursor stays put. */
  private apply(it: ArticleEdit | null): void {
    this.title.set(it?.title ?? '');
    this.slug.set(it?.slug ?? '');
    this.excerpt.set(it?.excerpt ?? '');
    this.body.set(it?.bodyHtml ?? '');
    this.categoryId.set(it?.categoryId ?? null);
    this.featuredId.set(it?.featuredMediaId ?? null);
    this.featuredUrl.set(it?.featuredMediaUrl ?? null);
    this.feature.set(it?.featureOnHomepage ?? false);
    this.parentId.set(it?.parentId ?? null);
    this.sortOrder.set(it?.sortOrder ?? 0);
    this.seoTitle.set(it?.seoTitle ?? '');
    this.seoDescription.set(it?.seoDescription ?? '');
    this.tagsText.set((it?.tags ?? []).join(', '));
  }

  protected async reload(): Promise<void> {
    const id = this.item()?.id;
    if (id) {
      this.loaded = undefined;
      await this.open(String(id));
    }
  }

  // ---------------------------------------------------------------- editing and saving

  protected set<T>(field: { set(value: T): void }, value: T): void {
    field.set(value);
    this.changed();
  }

  protected setCategory(value: string): void {
    this.categoryId.set(value ? Number(value) : null);
    this.changed();
  }

  protected setParent(value: string): void {
    this.parentId.set(value ? Number(value) : null);
    this.changed();
  }

  protected clearFeatured(): void {
    this.featuredId.set(null);
    this.featuredUrl.set(null);
    this.changed();
  }

  protected async addCategory(input: HTMLInputElement): Promise<void> {
    const name = input.value.trim();
    if (!name) {
      return;
    }
    try {
      const made = await this.api.createCategory(name);
      input.value = '';
      this.categories.update((c) => (c.some((x) => x.id === made.id) ? c : [...c, made].sort((a, b) => a.name.localeCompare(b.name))));
      this.categoryId.set(made.id);
      this.changed();
    } catch (e) {
      this.message.set(problemMessage(e));
    }
  }

  private changed(): void {
    if (!this.canEdit()) {
      return;
    }
    this.saveState.set('unsaved');
    this.message.set('');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), AUTOSAVE_MS);
  }

  private input(): ArticleInput {
    const blank = (s: string) => (s.trim() ? s.trim() : null);
    return {
      title: this.title().trim(),
      slug: blank(this.slug()),
      excerpt: blank(this.excerpt()),
      bodyHtml: this.body(),
      categoryId: this.categoryId(),
      featuredMediaId: this.featuredId(),
      featureOnHomepage: this.feature(),
      parentId: this.parentId(),
      sortOrder: this.sortOrder(),
      seoTitle: blank(this.seoTitle()),
      seoDescription: blank(this.seoDescription()),
      tags: this.tagsText().split(',').map((t) => t.trim()).filter(Boolean),
      version: this.item()?.version ?? 0,
    };
  }

  /** Saves now if there is anything to save, waiting for a save already under way. */
  protected async save(): Promise<void> {
    clearTimeout(this.timer);
    if (this.saving) {
      await this.saving;
    }
    if (!this.canEdit() || (this.saveState() !== 'unsaved' && this.saveState() !== 'error')) {
      return;
    }
    if (!this.title().trim()) {
      this.message.set('Give it a title to save it.');
      this.saveState.set('unsaved');
      return;
    }
    this.saving = this.write().finally(() => (this.saving = undefined));
    await this.saving;
  }

  private async write(): Promise<void> {
    this.saveState.set('saving');
    const sent = this.input();
    try {
      const existing = this.item();
      const kind: ContentKind = this.isPage() ? 'Page' : 'Article';
      const saved = existing ? await this.api.update(existing.id, sent) : await this.api.create(kind, sent);
      this.item.set(saved);
      this.slug.set(saved.slug);
      this.featuredUrl.set(saved.featuredMediaUrl);
      this.message.set('');
      // If more was typed while this was in flight, that is still unsaved.
      this.saveState.set(this.body() === sent.bodyHtml && this.title().trim() === sent.title ? 'saved' : 'unsaved');
      if (!existing) {
        this.loaded = String(saved.id);
        void this.router.navigate(['/studio/articles', saved.id], { replaceUrl: true });
      }
      if (this.saveState() === 'unsaved') {
        this.changed();
      }
    } catch (e) {
      if (isConflict(e)) {
        this.saveState.set('conflict');
        this.message.set(problemMessage(e, 'Someone else has changed this item since you opened it.'));
      } else {
        this.saveState.set('error');
        this.message.set(problemMessage(e, 'It could not be saved. Your text is still here; it will be saved again when you keep typing or press Save now.'));
      }
    }
  }

  // ---------------------------------------------------------------- workflow

  protected async moveTo(target: ArticleStatus, scheduledUtc: string | null = null): Promise<void> {
    await this.save();
    const it = this.item();
    if (!it || this.saveState() === 'error' || this.saveState() === 'conflict' || !this.title().trim()) {
      return;
    }
    this.busy.set(true);
    try {
      const moved = await this.api.transition(it.id, target, it.version, scheduledUtc);
      this.item.set(moved);
      this.scheduling.set(false);
      this.previewing.set(false);
      this.saveState.set('saved');
      this.message.set(`Moved to ${STATUS_LABEL[moved.status].toLowerCase()}.`);
    } catch (e) {
      this.message.set(problemMessage(e));
      if (isConflict(e)) {
        this.saveState.set('conflict');
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async schedule(localValue: string): Promise<void> {
    const when = new Date(localValue);                    // a datetime-local value is read as the editor's own time zone
    if (Number.isNaN(when.getTime())) {
      this.message.set('Choose a date and time.');
      return;
    }
    await this.moveTo('Scheduled', when.toISOString());
  }

  protected async remove(): Promise<void> {
    const it = this.item();
    if (!it || !confirm(`Delete “${it.title}”? This cannot be undone.`)) {
      return;
    }
    try {
      await this.api.remove(it.id);
      this.saveState.set('idle');
      await this.router.navigate(['/studio/articles']);
    } catch (e) {
      this.message.set(problemMessage(e));
    }
  }

  // ---------------------------------------------------------------- preview and history

  protected async togglePreview(): Promise<void> {
    if (!this.previewing()) {
      await this.save();                                  // the preview shows what the server kept, after cleaning
    }
    this.previewing.update((p) => !p);
  }

  protected async toggleRevisions(): Promise<void> {
    const show = !this.showRevisions();
    this.showRevisions.set(show);
    this.revision.set(null);
    const it = this.item();
    if (show && it) {
      await this.save();
      try {
        this.revisions.set(await this.api.revisions(it.id));
      } catch (e) {
        this.message.set(problemMessage(e));
      }
    }
  }

  protected async openRevision(no: number): Promise<void> {
    const it = this.item();
    if (it) {
      try {
        this.revision.set(await this.api.revision(it.id, no));
      } catch (e) {
        this.message.set(problemMessage(e));
      }
    }
  }

  protected async restore(no: number): Promise<void> {
    const it = this.item();
    if (!it) {
      return;
    }
    this.busy.set(true);
    try {
      const restored = await this.api.restore(it.id, no, it.version);
      this.item.set(restored);
      this.title.set(restored.title);
      this.body.set(restored.bodyHtml);
      this.saveState.set('saved');
      this.message.set(`Version ${no} restored as the newest version.`);
      this.revision.set(null);
      this.revisions.set(await this.api.revisions(it.id));
    } catch (e) {
      this.message.set(problemMessage(e));
      if (isConflict(e)) {
        this.saveState.set('conflict');
      }
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------------------------------------------------------- pictures

  protected picked(m: MediaView): void {
    const target = this.picker();
    this.pickError.set('');
    if (target === 'featured') {
      if (m.status !== 'Approved') {
        this.pickError.set('Only an approved picture can be the main picture. An editor can approve it in the Pictures page.');
        return;
      }
      this.featuredId.set(m.id);
      this.featuredUrl.set(m.url);
      this.changed();
    } else {
      this.richText()?.insertImage(m.url, m.caption ?? '');
    }
    this.picker.set(null);
  }
}
