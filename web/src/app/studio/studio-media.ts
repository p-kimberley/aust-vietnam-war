import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MediaLibrary } from './media-library';

/** The Pictures page of the Studio. */
@Component({
  selector: 'app-studio-media',
  imports: [MediaLibrary],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-media-library />`,
})
export class StudioMedia {}
