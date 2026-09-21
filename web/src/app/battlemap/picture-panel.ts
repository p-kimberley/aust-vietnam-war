import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, effect, inject, input, output, resource, signal, viewChild } from '@angular/core';
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

/** A picture members have put on the map: the picture itself, who took it and when, its likes, and a way to the incident it belongs to. */
@Component({
  selector: 'app-picture-panel',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:fullscreenchange)': 'onFullscreenChange()' },
  templateUrl: './picture-panel.html',
  styleUrl: './picture-panel.css',
})
export class PicturePanel {
  readonly pictureId = input.required<number>();
  readonly closed = output<void>();
  /** The picture belongs to an incident, and the person asked to see it. */
  readonly openIncident = output<number>();

  protected readonly auth = inject(AuthService);
  private readonly api = inject(CommunityService);
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly overlay = viewChild<ElementRef<HTMLElement>>('overlay');
  private readonly trigger = viewChild<ElementRef<HTMLElement>>('trigger');

  protected readonly picture = resource({
    params: () => this.pictureId(),
    loader: ({ params }) => this.api.mediaDetail(params),
  });
  /** What a like has changed since the picture was loaded. */
  private readonly changed = signal<{ id: number; likes: number; likedByMe: boolean } | null>(null);
  protected readonly message = signal('');
  /** The picture is filling the screen. */
  protected readonly fullscreen = signal(false);
  protected readonly formatBytes = formatBytes;
  protected readonly formatType = formatType;

  constructor() {
    // Move focus into the panel when a picture opens, so keyboard and screen-reader users land on it.
    effect(() => {
      this.pictureId();
      this.heading()?.nativeElement.focus();
      this.changed.set(null);
      this.message.set('');
      this.fullscreen.set(false);
    });
  }

  /**
   * Fills the screen with the picture: over the whole window, and where the browser allows it as true full screen too. The
   * window version is what a browser without full screen (an iPhone's, for one) gets.
   */
  protected openFullscreen(): void {
    this.fullscreen.set(true);
    afterNextRender(
      () => {
        const overlay = this.overlay()?.nativeElement;
        overlay?.querySelector<HTMLElement>('button')?.focus();
        overlay?.requestFullscreen?.().catch(() => undefined);
      },
      { injector: this.injector },
    );
  }

  protected closeFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    }
    this.fullscreen.set(false);
    afterNextRender(() => this.trigger()?.nativeElement.focus(), { injector: this.injector });
  }

  /** The reader left true full screen with Escape or the browser's own button, which leaves the picture over the window. */
  protected onFullscreenChange(): void {
    if (this.fullscreen() && !document.fullscreenElement) {
      this.fullscreen.set(false);
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
}
