import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-studio-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Studio</h1>
    <p>Articles, media and moderation will appear here.</p>
  `,
})
export class StudioHome {}
