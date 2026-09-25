import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, afterNextRender, computed, effect, untracked, inject, input, output, resource, signal, viewChild } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { problemMessage } from '../studio/studio-api';
import { CommunityService, IncidentMediaView } from './community/community';

/** A file size for a person: bytes below a kilobyte, then kilobytes, then megabytes, to one decimal place. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The kind of image, from its content type: `image/jpeg` is JPEG. */
export function formatType(contentType: string): string {
  const kind = contentType.split('/')[1] ?? contentType;
  return (kind === 'jpeg' ? 'jpg' : kind).toUpperCase();
}

/** Pictures placed within this many metres of each other are at the same place, and are stepped through together. */
export const SAME_PLACE_METRES = 30;

/** One of the pictures the open one is shown among, with what is needed to show it before its own details have loaded. */
export interface Sibling {
  id: number;
  url: string;
  caption: string | null;
}

/** The box, in degrees, round a place that holds everything within `metres` of it. */
function boxAround(lat: number, lon: number, metres: number): [number, number, number, number] {
  const dLat = metres / 111_320;
  const dLon = metres / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
}

/** How long a slide to the next or previous picture takes. */
export const SLIDE_MS = 300;
/** A swipe changes picture once it has gone this share of the stage's width, or when it is a flick this fast (pixels a millisecond). */
const SWIPE_SHARE = 0.2;
const FLICK_SPEED = 0.5;
/** Past the first or last picture, the track moves only this share of the way the finger does, to show there is nothing there. */
const EDGE_RESISTANCE = 0.3;

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A picture members have added, in a dialog over the map: the picture large on one side, and beside it who took it and when, where
 * it is, its likes, and a way to the incident it belongs to. The full-screen button fills the screen with the picture in this page
 * (true full screen where the browser allows it, and over the whole window where it does not), never in another tab.
 *
 * The arrows either side of the picture (and the left and right arrow keys) step through the pictures that go with it: the others of
 * its incident, then any placed at the same spot. The set is worked out when the dialog opens and kept while stepping through it.
 * The pictures slide from one to the next, and the picture can be swiped (or dragged with the mouse) to the next or previous one; it
 * follows the finger, and springs back if let go too soon. Anyone who asks for less motion gets the change at once instead.
 *
 * Escape leaves full screen first, then closes the dialog; Tab stays inside it; focus goes back where it was when it closes.
 */
@Component({
  selector: 'app-picture-viewer',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:fullscreenchange)': 'onFullscreenChange()' },
  templateUrl: './picture-viewer.html',
  styleUrl: './picture-viewer.css',
})
export class PictureViewer implements OnDestroy {
  readonly pictureId = input.required<number>();
  readonly closed = output<void>();
  /** The picture belongs to an incident, and the person asked to see it. */
  readonly openIncident = output<number>();
  /** The previous or next picture of the set was asked for; the parent opens it here. */
  readonly navigate = output<number>();

  protected readonly auth = inject(AuthService);
  private readonly api = inject(CommunityService);
  private readonly injector = inject(Injector);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly closeButton = viewChild<ElementRef<HTMLElement>>('closeButton');
  private readonly fullButton = viewChild<ElementRef<HTMLElement>>('fullButton');
  private readonly previousButton = viewChild<ElementRef<HTMLButtonElement>>('previousButton');
  private readonly nextButton = viewChild<ElementRef<HTMLButtonElement>>('nextButton');
  /** What had focus before the dialog opened, to give it back when it closes. */
  private readonly opener = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  protected readonly picture = resource({
    params: () => this.pictureId(),
    loader: ({ params }) => this.api.mediaDetail(params),
  });
  /** The picture once it has loaded; `null` while it loads, when it failed to, or when there is no such picture. */
  protected readonly shown = computed(() => (this.picture.hasValue() ? this.picture.value() : null));
  /** The pictures stepped through, in order, the open one among them; empty until they are known, and for a picture on its own. */
  protected readonly siblings = signal<readonly Sibling[]>([]);
  /** Where the open picture is in the set, from 0; -1 while the set is not known. */
  protected readonly position = computed(() => this.siblings().findIndex((s) => s.id === this.pictureId()));
  protected readonly previous = computed(() => (this.position() > 0 ? this.siblings()[this.position() - 1] : null));
  protected readonly next = computed(() => {
    const i = this.position();
    return i >= 0 && i < this.siblings().length - 1 ? this.siblings()[i + 1] : null;
  });
  /** What the stage shows: the picture once loaded, or, while the next one loads, its file straight away, so stepping is quick. */
  protected readonly onStage = computed(() => {
    const p = this.shown();
    if (p) return { url: p.url, caption: p.caption, credit: p.credit };
    const s = this.siblings().find((x) => x.id === this.pictureId());
    return s ? { url: s.url, caption: s.caption, credit: null } : null;
  });
  private setTicket = 0;
  /** Where the track is: 0 on the open picture, -1 sliding to the next, 1 to the previous; and how far a finger has dragged it, in pixels. */
  protected readonly shift = signal(0);
  protected readonly drag = signal(0);
  /** The track is animating to where it is going (a slide or a spring back), rather than following a finger. */
  protected readonly sliding = signal(false);
  protected readonly trackTransform = computed(() => `translateX(calc(${this.shift() * 100}% + ${this.drag()}px))`);
  private slideTimer?: ReturnType<typeof setTimeout>;
  /** A drag has just ended, so the click that follows it is not a click on the dim round the dialog. */
  private dragged = false;
  /** What a like has changed since the picture was loaded. */
  private readonly changed = signal<{ id: number; likes: number; likedByMe: boolean } | null>(null);
  protected readonly message = signal('');
  /** The picture is filling the screen. */
  protected readonly fullscreen = signal(false);
  protected readonly formatBytes = formatBytes;
  protected readonly formatType = formatType;

  constructor() {
    // Focus starts on the close button, so the keyboard lands in the dialog.
    afterNextRender(() => this.closeButton()?.nativeElement.focus(), { injector: this.injector });
    // Stepping to another picture keeps full screen, and where focus is.
    effect(() => {
      this.pictureId();
      this.changed.set(null);
      this.message.set('');
    });
    // The set is worked out for the first picture, and again only for one outside it (which stepping never reaches).
    effect(() => {
      const p = this.shown();
      if (p && !untracked(this.siblings).some((s) => s.id === p.id)) {
        void this.loadSiblings(p);
      }
    });
  }

  /** The others of the picture's incident, then those placed within {@link SAME_PLACE_METRES} of it, each once, with it among them. */
  private async loadSiblings(p: IncidentMediaView): Promise<void> {
    const ticket = ++this.setTicket;
    const none: IncidentMediaView[] = [];
    const [own, near] = await Promise.all([
      p.contactId !== null ? this.api.media(p.contactId).catch(() => none) : none,
      p.lat !== null && p.lon !== null ? this.api.mediaInArea(...boxAround(p.lat, p.lon, SAME_PLACE_METRES)).catch(() => none) : none,
    ]);
    if (ticket !== this.setTicket) {
      return;
    }
    const all = [...own, ...near];
    if (!all.some((x) => x.id === p.id)) all.unshift(p);
    const seen = new Set<number>();
    const set = all.filter((x) => !seen.has(x.id) && !!seen.add(x.id)).map(({ id, url, caption }) => ({ id, url, caption }));
    this.siblings.set(set.length > 1 ? set : []);
  }

  /**
   * Steps to the previous or next picture of the set, sliding to it. The parent opens it in the same pass that puts the track back,
   * so the picture slid in is the one then shown. Focus stays on the arrow, or moves to the other one at the end of the set.
   */
  protected step(to: Sibling | null): void {
    if (!to || this.sliding()) {
      return;
    }
    if (!this.animates()) {
      this.arrive(to);
      return;
    }
    this.sliding.set(true);
    this.shift.set(to === this.next() ? -1 : 1);
    this.drag.set(0);
    clearTimeout(this.slideTimer);
    this.slideTimer = setTimeout(() => this.arrive(to), SLIDE_MS);
  }

  /** Whether the pictures slide: not for anyone who asked for less motion, nor where that cannot be asked (as in tests). */
  private animates(): boolean {
    return typeof globalThis.matchMedia === 'function' && !globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Opens the picture slid to, and puts the track back under it without a transition. */
  private arrive(to: Sibling): void {
    this.navigate.emit(to.id);
    this.sliding.set(false);
    this.shift.set(0);
    this.drag.set(0);
    afterNextRender(
      () => {
        const active = document.activeElement as HTMLButtonElement | null;
        if (active?.disabled) (active === this.previousButton()?.nativeElement ? this.nextButton() : this.previousButton())?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  /**
   * Starts following a finger or the mouse across the picture. A mostly sideways move drags the track; let go far enough along (or
   * with a flick) it slides on to that picture, and otherwise springs back. A mostly up-and-down move is left to the page.
   */
  protected onPointerDown(event: PointerEvent): void {
    if (this.siblings().length < 2 || this.sliding() || event.button !== 0) {
      return;
    }
    const track = event.currentTarget as HTMLElement;
    const width = track.clientWidth || 1;
    const start = { x: event.clientX, y: event.clientY };
    let sideways: boolean | null = null;
    let last = { x: event.clientX, t: performance.now() };
    let speed = 0;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (sideways === null) {
        if (Math.hypot(dx, dy) < 6) return;
        sideways = Math.abs(dx) > Math.abs(dy);
        if (!sideways) return end();
        track.setPointerCapture?.(e.pointerId);
      }
      const now = performance.now();
      speed = (e.clientX - last.x) / Math.max(1, now - last.t);
      last = { x: e.clientX, t: now };
      const nothingThere = dx > 0 ? !this.previous() : !this.next();
      this.drag.set(nothingThere ? dx * EDGE_RESISTANCE : dx);
    };
    const end = () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', end);
      track.removeEventListener('pointercancel', end);
      if (!sideways) return;
      this.dragged = true;
      setTimeout(() => (this.dragged = false));
      const dx = this.drag();
      const to = dx < 0 ? this.next() : this.previous();
      const far = Math.abs(dx) > width * SWIPE_SHARE || (Math.abs(speed) > FLICK_SPEED && Math.sign(speed) === Math.sign(dx));
      if (to && far && dx !== 0) {
        this.step(to);
      } else {
        this.springBack();
      }
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
  }

  /** A drag let go too soon: the picture slides back to where it was. */
  private springBack(): void {
    if (!this.animates()) {
      this.drag.set(0);
      return;
    }
    this.sliding.set(true);
    this.drag.set(0);
    clearTimeout(this.slideTimer);
    this.slideTimer = setTimeout(() => this.sliding.set(false), SLIDE_MS);
  }

  /** A click on the dim round the dialog closes it, unless it is the end of a drag that strayed off the picture. */
  protected backdropClicked(): void {
    if (!this.dragged) {
      this.close();
    }
  }

  protected close(): void {
    this.leaveFullscreen();
    this.closed.emit();
  }

  /** Fills the screen with the picture, in this page: true full screen where the browser allows it, and over the whole window where it does not. */
  protected openFullscreen(): void {
    this.fullscreen.set(true);
    afterNextRender(
      () => {
        const stage = this.stage()?.nativeElement;
        stage?.querySelector<HTMLElement>('.stage__exit')?.focus();
        stage?.requestFullscreen?.().catch(() => undefined);
      },
      { injector: this.injector },
    );
  }

  protected closeFullscreen(): void {
    this.leaveFullscreen();
    afterNextRender(() => this.fullButton()?.nativeElement.focus(), { injector: this.injector });
  }

  private leaveFullscreen(): void {
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen?.();
    }
    this.fullscreen.set(false);
  }

  /** The reader left true full screen with Escape or the browser's own control, which leaves the picture in the dialog. */
  protected onFullscreenChange(): void {
    if (this.fullscreen() && !document.fullscreenElement) {
      this.fullscreen.set(false);
    }
  }

  /** Escape steps back one level; Tab goes round the dialog (or, full screen, stays on its one button). */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.step(event.key === 'ArrowLeft' ? this.previous() : this.next());
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.fullscreen()) {
        this.closeFullscreen();
      } else {
        this.close();
      }
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const scope = this.fullscreen() ? this.stage()?.nativeElement : this.box()?.nativeElement;
    const items = [...(scope?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (items.length === 1 || (event.shiftKey && active === first) || (!event.shiftKey && active === last) || !items.includes(active as HTMLElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  protected likes(p: IncidentMediaView): number {
    const c = this.changed();
    return c && c.id === p.id ? c.likes : p.likes;
  }

  protected liked(p: IncidentMediaView): boolean {
    const c = this.changed();
    return c && c.id === p.id ? c.likedByMe : p.likedByMe;
  }

  protected async like(p: IncidentMediaView): Promise<void> {
    try {
      const result = await this.api.toggleLike(p.id);
      this.changed.set({ id: p.id, likes: result.likes, likedByMe: result.liked });
      this.message.set('');
    } catch (e) {
      this.message.set(problemMessage(e, 'The like could not be saved.'));
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.slideTimer);
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen?.();
    }
    if (this.opener?.isConnected) {
      this.opener.focus();
    }
  }
}
