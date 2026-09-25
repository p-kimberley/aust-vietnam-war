import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, afterNextRender, computed, effect, inject, input, output, resource, signal, viewChild } from '@angular/core';
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

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A picture members have added, in a dialog over the map: the picture large on one side, and beside it who took it and when, where
 * it is, its likes, and a way to the incident it belongs to. The full-screen button fills the screen with the picture in this page
 * (true full screen where the browser allows it, and over the whole window where it does not), never in another tab.
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

  protected readonly auth = inject(AuthService);
  private readonly api = inject(CommunityService);
  private readonly injector = inject(Injector);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly closeButton = viewChild<ElementRef<HTMLElement>>('closeButton');
  private readonly fullButton = viewChild<ElementRef<HTMLElement>>('fullButton');
  /** What had focus before the dialog opened, to give it back when it closes. */
  private readonly opener = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null);

  protected readonly picture = resource({
    params: () => this.pictureId(),
    loader: ({ params }) => this.api.mediaDetail(params),
  });
  /** The picture once it has loaded; `null` while it loads, when it failed to, or when there is no such picture. */
  protected readonly shown = computed(() => (this.picture.hasValue() ? this.picture.value() : null));
  /** What a like has changed since the picture was loaded. */
  private readonly changed = signal<{ id: number; likes: number; likedByMe: boolean } | null>(null);
  protected readonly message = signal('');
  /** The picture is filling the screen. */
  protected readonly fullscreen = signal(false);
  protected readonly formatBytes = formatBytes;
  protected readonly formatType = formatType;

  constructor() {
    // Each picture starts in the dialog, not full screen, with focus on the close button so the keyboard lands in the dialog.
    effect(() => {
      this.pictureId();
      this.changed.set(null);
      this.message.set('');
      this.leaveFullscreen();
      afterNextRender(() => this.closeButton()?.nativeElement.focus(), { injector: this.injector });
    });
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
