import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, output, resource, signal, viewChild } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { problemMessage } from '../studio/studio-api';
import { CommunityService, IncidentMediaView } from './community/community';

/** A picture members have put on the map: the picture itself, who took it and when, its likes, and a way to the incident it belongs to. */
@Component({
  selector: 'app-picture-panel',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  protected readonly picture = resource({
    params: () => this.pictureId(),
    loader: ({ params }) => this.api.mediaDetail(params),
  });
  /** What a like has changed since the picture was loaded. */
  private readonly changed = signal<{ id: number; likes: number; likedByMe: boolean } | null>(null);
  protected readonly message = signal('');

  constructor() {
    // Move focus into the panel when a picture opens, so keyboard and screen-reader users land on it.
    effect(() => {
      this.pictureId();
      this.heading()?.nativeElement.focus();
      this.changed.set(null);
      this.message.set('');
    });
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
