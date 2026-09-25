import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, output, signal, viewChild } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { problemMessage } from '../studio/studio-api';
import { CommunityService, IncidentMediaView, PictureHit, PictureRef, PictureSort } from './community/community';
import { PicturePlacementService } from './picture-placement.service';
import { Icon } from './icon';

/** How many pictures one request brings back, and each "Show more" adds. */
export const PICTURES_PAGE_SIZE = 24;
/** How long typing must pause before the pictures are searched. */
export const PICTURES_DELAY_MS = 300;

type Status = 'loading' | 'ready' | 'error';
type Mode = 'browse' | 'add';

/**
 * The community's images, in the panel that flies out from the left (the Images tab). It lists the newest and narrows to those whose
 * caption or credit has the words typed; choosing one opens it in the picture viewer, leaving the map where it is.
 *
 * "Add an image" swaps the list for a form, and "Back to the images" swaps it back. A member can add an image anywhere on the map:
 * they choose the file, drag the pin from the panel onto the map (or put
 * it in the middle of the view), move it about until it is right, and send it. An editor looks at it before it appears, unless they
 * are an editor themselves.
 */
@Component({
  selector: 'app-pictures-panel',
  imports: [DatePipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pics" aria-labelledby="pics-title">
      <header class="head">
        <h2 id="pics-title">Images</h2>
        <button type="button" class="close" aria-label="Close the images" (click)="closed.emit()">×</button>
      </header>

      @if (mode() === 'browse') {
        <div class="find">
          <div class="search">
            <svg class="search__icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
              <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2" />
              <path d="M13 13l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
            <input
              type="search"
              class="input search__input"
              autocomplete="off"
              maxlength="100"
              placeholder="Search captions and credits"
              aria-label="Search the images by caption or credit"
              [value]="query()"
              (input)="onInput($any($event.target).value)"
            />
          </div>
          <button type="button" class="button primary add-button" (click)="setMode('add')"><app-icon name="image-plus" />Add an image</button>
        </div>
        <div class="bar">
          <p class="count data" role="status" aria-live="polite">{{ summary() }}</p>
          <label class="sort">
            Sort
            <select (change)="setSort($any($event.target).value)">
              @for (o of sortOptions(); track o.value) {
                <option [value]="o.value" [selected]="o.value === sortShown()">{{ o.label }}</option>
              }
            </select>
          </label>
        </div>
        @if (status() === 'error') {
          <p class="error" role="alert">The images could not be searched. Try again in a moment.</p>
          <button type="button" class="button more" (click)="reload()"><app-icon name="refresh" />Try again</button>
        }
        <ul class="grid" aria-label="Images found">
          @for (p of pictures(); track p.id) {
            <li>
              <button type="button" class="hit" (click)="open(p)">
                <img [src]="p.thumbUrl" [alt]="p.caption || 'An image'" loading="lazy" />
                <span class="hit__caption">{{ p.caption || 'Untitled' }}</span>
                @if (p.credit || p.dateTaken) {
                  <span class="hit__credit">{{ p.credit }}{{ p.credit && p.dateTaken ? ' · ' : '' }}{{ p.dateTaken ? (p.dateTaken | date: 'd MMM y') : '' }}</span>
                }
              </button>
            </li>
          }
        </ul>
        @if (pictures().length < total() && status() !== 'error') {
          <button type="button" class="button more" [disabled]="status() === 'loading'" (click)="showMore()"><app-icon name="chevron-down" />Show more</button>
        }
      } @else {
        <div class="add">
          <button type="button" class="back" (click)="setMode('browse')"><app-icon name="arrow-left" />Back to the images</button>
          @if (!auth.isAuthenticated()) {
            <p class="hint"><button type="button" class="link" (click)="auth.login()">Sign in</button> to add an image.</p>
          } @else {
            <form (submit)="$event.preventDefault(); send()">
              <label class="field">
                <span>Image (JPEG, PNG or WebP)</span>
                <input #fileInput type="file" accept="image/jpeg,image/png,image/webp" (change)="choose($any($event.target))" />
              </label>
              @if (preview(); as url) {
                <img class="preview" [src]="url" alt="The image chosen" />
              }

              <fieldset class="place">
                <legend>Where on the map</legend>
                <div class="place__row">
                  <button
                    type="button"
                    class="pin"
                    [class.is-dragging]="dragging()"
                    aria-label="Put the pin in the middle of the map"
                    title="Drag onto the map"
                    (pointerdown)="startDrag($event)"
                    (click)="placeAtCentre()"
                  >
                    <svg viewBox="0 0 24 32" aria-hidden="true" focusable="false"><path d="M12 1C6 1 1.5 5.5 1.5 11.3 1.5 19 12 31 12 31s10.5-12 10.5-19.7C22.5 5.5 18 1 12 1z" /><circle cx="12" cy="11.5" r="4" /></svg>
                  </button>
                  <p class="hint">
                    @if (placement.place(); as at) {
                      Placed at <span class="data">{{ at.lat.toFixed(5) }}, {{ at.lon.toFixed(5) }}</span>. Drag the pin on the map to move it.
                    } @else {
                      Drag the pin onto the map where the image was taken, or press it to put it in the middle of the map.
                    }
                  </p>
                </div>
              </fieldset>

              <label class="field"><span>Caption</span><input class="input" type="text" maxlength="500" [value]="caption()" (input)="caption.set($any($event.target).value)" /></label>
              <label class="field"><span>Credit</span><input class="input" type="text" maxlength="200" [value]="credit()" (input)="credit.set($any($event.target).value)" /></label>
              <label class="field"><span>Date taken (optional)</span><input class="input" type="date" [value]="taken()" (input)="taken.set($any($event.target).value)" /></label>
              <p class="hint">{{ isEditor() ? 'Images from editors appear at once.' : 'An editor looks at new images before they appear on the map.' }}</p>
              @if (sendError()) {
                <p class="error" role="alert">{{ sendError() }}</p>
              }
              <div class="actions">
                <button type="submit" class="button primary" [disabled]="!canSend()"><app-icon name="upload" />{{ sending() ? 'Sending…' : isEditor() ? 'Add the image' : 'Send for approval' }}</button>
                <button type="button" class="button" [disabled]="sending()" (click)="reset()"><app-icon name="rotate-ccw" />Start again</button>
              </div>
            </form>
          }
          @if (sent(); as done) {
            <div class="sent" role="status">
              <p>{{ done.status === 'Approved' ? 'Your image is on the map.' : 'Thank you. Your image will appear on the map once an editor has looked at it.' }}</p>
              <button type="button" class="button" (click)="openPicture.emit({ id: done.id, lat: done.lat, lon: done.lon })"><app-icon name="eye" />View it</button>
            </div>
          }
        </div>
      }
    </section>
    @if (dragging(); as at) {
      <div class="ghost" aria-hidden="true" [style.left.px]="at.x" [style.top.px]="at.y">
        <svg viewBox="0 0 24 32"><path d="M12 1C6 1 1.5 5.5 1.5 11.3 1.5 19 12 31 12 31s10.5-12 10.5-19.7C22.5 5.5 18 1 12 1z" /><circle cx="12" cy="11.5" r="4" /></svg>
      </div>
    }
  `,
  styles: `
    /* The full height of the fly-out from the start, so it does not grow as the list arrives, part way through sliding in. */
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
    }
    .pics {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      color: var(--paper);
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
      color: var(--smoke-yellow);
      font-family: var(--font-display);
      font-size: 1rem;
    }
    .close,
    .button,
    .back,
    .link {
      color: var(--paper);
      font: inherit;
      background: none;
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
      cursor: pointer;
    }
    .close {
      width: 2rem;
      height: 2rem;
      padding: 0;
      font-size: 1.4rem;
      line-height: 1;
    }
    .button {
      padding: 0.35rem 0.75rem;
    }
    .button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .primary {
      color: var(--ink);
      background: var(--brass);
      border-color: var(--brass);
    }
    .link {
      padding: 0;
      color: var(--smoke-yellow);
      text-decoration: underline;
      border: 0;
    }
    /* The search box, and beside it the button to add an image. */
    .find {
      display: flex;
      align-items: stretch;
      gap: 0.5rem;
      padding: 0.6rem 0.75rem 0;
    }
    .search {
      position: relative;
      flex: 1;
      min-width: 0;
    }
    .search__icon {
      position: absolute;
      top: 50%;
      left: 0.55rem;
      color: var(--olive-500);
      transform: translateY(-50%);
      pointer-events: none;
    }
    /* Room at the left for the icon (more specific than .input, which comes later). */
    .search .search__input {
      height: 100%;
      padding-left: 1.9rem;
    }
    .add-button {
      flex: none;
      white-space: nowrap;
    }
    .back {
      align-self: flex-start;
      margin-bottom: 0.6rem;
      padding: 0.25rem 0.6rem;
      font-size: 0.85rem;
    }
    .input {
      box-sizing: border-box;
      width: 100%;
      padding: 0.4rem 0.6rem;
      color: var(--ink);
      font: inherit;
      font-size: 0.9rem;
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: var(--radius);
    }
    /* How many there are, and beside it the order they are in. */
    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin: 0.4rem 0.75rem;
    }
    .count {
      margin: 0;
      color: var(--khaki);
      font-size: 0.78rem;
    }
    .sort {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      color: var(--khaki);
      font-size: 0.78rem;
    }
    .sort select {
      padding: 0.2rem 0.3rem;
      color: var(--ink);
      font: inherit;
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: var(--radius);
    }
    .sort select:focus-visible {
      outline: 2px solid var(--smoke-yellow);
      outline-offset: 2px;
    }
    .error {
      margin: 0.4rem 0;
      color: var(--contact-red-bright);
    }
    .pics > .error {
      margin: 0 0.75rem 0.4rem;
    }
    .grid {
      flex: 1 1 auto;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
      align-content: start;
      gap: 0.5rem;
      min-height: 0;
      margin: 0;
      padding: 0 0.75rem 0.5rem;
      overflow-y: auto;
      list-style: none;
    }
    .hit {
      display: block;
      width: 100%;
      padding: 0;
      color: var(--paper);
      font: inherit;
      text-align: left;
      background: none;
      border: 0;
      cursor: zoom-in;
    }
    .hit img {
      display: block;
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
    }
    .hit:hover img {
      border-color: var(--smoke-yellow);
    }
    .hit__caption,
    .hit__credit {
      display: block;
      overflow: hidden;
      font-size: 0.78rem;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .hit__credit {
      color: var(--khaki);
      font-size: 0.72rem;
    }
    .more {
      margin: 0.5rem 0.75rem 0.75rem;
    }
    .add {
      min-height: 0;
      padding: 0.6rem 0.75rem 0.75rem;
      overflow-y: auto;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.85rem;
    }
    .field span {
      color: var(--khaki);
    }
    .preview {
      display: block;
      max-width: 100%;
      max-height: 10rem;
      object-fit: contain;
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
    }
    .place {
      margin: 0;
      padding: 0.5rem 0.6rem;
      border: 1px solid var(--olive-500);
      border-radius: var(--radius);
    }
    .place legend {
      padding: 0 0.3rem;
      color: var(--khaki);
      font-size: 0.85rem;
    }
    .place__row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .pin {
      flex: none;
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 3.25rem;
      padding: 0;
      color: var(--ink);
      background: var(--olive-700);
      border: 1px dashed var(--smoke-yellow);
      border-radius: var(--radius);
      cursor: grab;
      touch-action: none;
    }
    .pin svg,
    .ghost svg {
      width: 1.5rem;
      height: 2rem;
      fill: var(--smoke-yellow);
      stroke: var(--ink);
      stroke-width: 1.5;
    }
    .pin.is-dragging {
      opacity: 0.4;
    }
    /* The pin following the pointer while it is dragged: its tip is at the pointer. */
    .ghost {
      position: fixed;
      z-index: 1000;
      pointer-events: none;
      transform: translate(-50%, -100%);
      filter: drop-shadow(0 2px 3px rgb(0 0 0 / 0.5));
    }
    .ghost svg {
      width: 2rem;
      height: 2.65rem;
    }
    .hint {
      margin: 0;
      color: var(--khaki);
      font-size: 0.8rem;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .sent {
      margin-top: 0.75rem;
      padding: 0.6rem;
      border: 1px solid var(--smoke-yellow);
      border-radius: var(--radius);
    }
    .sent p {
      margin: 0 0 0.5rem;
    }
    .close:focus-visible,
    .button:focus-visible,
    .back:focus-visible,
    .link:focus-visible,
    .hit:focus-visible,
    .pin:focus-visible,
    .input:focus-visible {
      outline: 2px solid var(--smoke-yellow);
      outline-offset: 2px;
    }
  `,
})
export class PicturesPanel implements OnDestroy {
  /** The panel was closed. */
  readonly closed = output<void>();
  /** A picture was chosen, to be shown in the viewer. The map stays where it is; the viewer offers a way to the picture's place. */
  readonly openPicture = output<PictureRef>();
  /** A picture was added; one that is already approved can go straight onto the map. */
  readonly added = output<IncidentMediaView>();

  protected readonly auth = inject(AuthService);
  protected readonly placement = inject(PicturePlacementService);
  private readonly api = inject(CommunityService);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;
  private page = 0;

  protected readonly mode = signal<Mode>('browse');

  // ---- finding
  protected readonly query = signal('');
  protected readonly pictures = signal<readonly PictureHit[]>([]);
  protected readonly total = signal(0);
  protected readonly status = signal<Status>('loading');
  protected readonly summary = computed(() => {
    if (this.status() === 'loading' && this.pictures().length === 0) {
      return 'Loading the images…';
    }
    const total = this.total();
    const shown = this.pictures().length;
    if (total === 0) {
      return this.status() === 'error' ? '' : this.query().trim() ? 'No images match.' : 'No images have been added yet.';
    }
    return shown < total ? `Showing ${shown} of ${total} images` : `${total} ${total === 1 ? 'image' : 'images'}`;
  });

  // ---- adding
  private file: File | null = null;
  protected readonly preview = signal<string | null>(null);
  protected readonly caption = signal('');
  protected readonly credit = signal('');
  protected readonly taken = signal('');
  protected readonly sending = signal(false);
  protected readonly sendError = signal('');
  /** The picture just sent, to say what happens next and offer a look at it. */
  protected readonly sent = signal<IncidentMediaView | null>(null);
  /** Where the pin being dragged from the panel is on the screen, or `null` when none is. */
  protected readonly dragging = signal<{ x: number; y: number } | null>(null);
  private readonly chosen = signal(false);
  protected readonly canSend = computed(() => this.chosen() && this.placement.place() !== null && !this.sending());
  /** The pointer moved far enough after pressing the pin that this is a drag, not a press. */
  private dragged = false;

  constructor() {
    void this.load(true);
  }

  protected isEditor(): boolean {
    return this.auth.hasRole('editor');
  }

  protected setMode(mode: Mode): void {
    this.mode.set(mode);
  }

  // ---- finding

  /** The order chosen; `null` until one is, which is best match for a search and newest first otherwise. */
  protected readonly sort = signal<PictureSort | null>(null);
  /** The order the list is in now, for the drop-down. */
  protected readonly sortShown = computed<PictureSort>(() => this.sort() ?? (this.query().trim() ? 'relevance' : 'newest'));
  /** Best match only means something for a search. */
  protected readonly sortOptions = computed(() => [
    ...(this.query().trim() ? [{ value: 'relevance' as const, label: 'Best match' }] : []),
    { value: 'newest' as const, label: 'Newest added' },
    { value: 'oldest' as const, label: 'Oldest added' },
    { value: 'taken-newest' as const, label: 'Date taken, latest first' },
    { value: 'taken-oldest' as const, label: 'Date taken, earliest first' },
  ]);

  protected setSort(value: string): void {
    this.sort.set(value as PictureSort);
    clearTimeout(this.timer);
    void this.load(true);
  }

  protected onInput(value: string): void {
    this.query.set(value);
    clearTimeout(this.timer);
    this.status.set('loading');
    this.timer = setTimeout(() => void this.load(true), PICTURES_DELAY_MS);
  }

  protected showMore(): void {
    void this.load(false);
  }

  protected reload(): void {
    void this.load(true);
  }

  protected open(p: PictureHit): void {
    this.openPicture.emit({ id: p.id, lat: p.lat, lon: p.lon });
  }

  /** Asks for a page of pictures: the first, for a new search, or the one after what is shown. */
  private async load(fresh: boolean): Promise<void> {
    const seq = ++this.seq;
    const page = fresh ? 1 : this.page + 1;
    this.status.set('loading');
    try {
      // Best match was for a search; once the words are cleared there is none, so the list goes back to newest first.
      const sort = this.sort() === 'relevance' && !this.query().trim() ? null : this.sort();
      const result = await this.api.searchPictures(this.query().trim(), page, PICTURES_PAGE_SIZE, sort);
      if (seq !== this.seq) {
        return;
      }
      this.page = page;
      this.pictures.set(fresh ? result.items : [...this.pictures(), ...result.items]);
      this.total.set(result.total);
      this.status.set('ready');
    } catch (e) {
      if (seq !== this.seq) {
        return;
      }
      console.warn('The pictures could not be searched', e);
      this.status.set('error');
    }
  }

  // ---- adding

  protected choose(input: HTMLInputElement): void {
    this.file = input.files?.[0] ?? null;
    this.chosen.set(!!this.file);
    this.setPreview(this.file && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(this.file) : null);
    this.sendError.set('');
  }

  protected placeAtCentre(): void {
    // A drag that ended in a click on the pin itself is not a request for the middle of the map.
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    this.placement.placeAtCentre();
  }

  /** Starts dragging the pin out of the panel; it follows the pointer, and is put on the map where it is let go. */
  protected startDrag(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    const pin = event.currentTarget as HTMLElement;
    const start = { x: event.clientX, y: event.clientY };
    this.dragged = false;
    pin.setPointerCapture?.(event.pointerId);
    const move = (e: PointerEvent) => {
      if (!this.dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) {
        return;
      }
      this.dragged = true;
      this.dragging.set({ x: e.clientX, y: e.clientY });
    };
    const end = (e: PointerEvent) => {
      pin.removeEventListener('pointermove', move);
      pin.removeEventListener('pointerup', end);
      pin.removeEventListener('pointercancel', end);
      this.dragging.set(null);
      if (this.dragged && e.type === 'pointerup') {
        this.placement.dropAt(e.clientX, e.clientY);
      }
    };
    pin.addEventListener('pointermove', move);
    pin.addEventListener('pointerup', end);
    pin.addEventListener('pointercancel', end);
  }

  protected async send(): Promise<void> {
    const place = this.placement.place();
    if (!this.file || !place || this.sending()) {
      return;
    }
    this.sending.set(true);
    this.sendError.set('');
    try {
      const picture = await this.api.placeMedia(this.file, place, this.caption().trim(), this.credit().trim(), this.taken());
      this.sent.set(picture);
      this.added.emit(picture);
      this.clearForm();
    } catch (e) {
      this.sendError.set(problemMessage(e, 'The image could not be added.'));
    } finally {
      this.sending.set(false);
    }
  }

  protected reset(): void {
    this.sent.set(null);
    this.sendError.set('');
    this.clearForm();
  }

  private clearForm(): void {
    this.file = null;
    this.chosen.set(false);
    this.caption.set('');
    this.credit.set('');
    this.taken.set('');
    this.setPreview(null);
    this.placement.clear();
    const input = this.fileInput()?.nativeElement;
    if (input) {
      input.value = '';
    }
  }

  private setPreview(url: string | null): void {
    const old = this.preview();
    if (old && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(old);
    }
    this.preview.set(url);
    this.placement.setPreview(url);
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.setPreview(null);
    this.placement.clear();
  }
}
