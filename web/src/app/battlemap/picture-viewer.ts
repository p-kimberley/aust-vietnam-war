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

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A picture members have added, in a dialog over the map: the picture large on one side, and beside it who took it and when, where
 * it is, its likes, and a way to the incident it belongs to. The full-screen button fills the screen with the picture in this page
 * (true full screen where the browser allows it, and over the whole window where it does not), never in another tab.
 *
 * The arrows either side of the picture (and the left and right arrow keys) step through the pictures that go with it: the others of
 * its incident, then any placed at the same spot. The set is worked out when the dialog opens and kept while stepping through it.
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
    // The pictures either side are fetched ahead, so a step shows at once.
    effect(() => {
      for (const s of [this.previous(), this.next()]) {
        if (s && typeof Image !== 'undefined') new Image().src = s.url;
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

  /** Steps to the previous or next picture of the set. Focus stays on the arrow, or moves to the other one at the end of the set. */
  protected step(to: Sibling | null): void {
    if (!to) {
      return;
    }
    this.navigate.emit(to.id);
    afterNextRender(
      () => {
        const active = document.activeElement as HTMLButtonElement | null;
        if (active?.disabled) (active === this.previousButton()?.nativeElement ? this.nextButton() : this.previousButton())?.nativeElement.focus();
      },
      { injector: this.injector },
    );
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
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen?.();
    }
    if (this.opener?.isConnected) {
      this.opener.focus();
    }
  }
}
