import { ChangeDetectionStrategy, Component } from '@angular/core';

/** Placeholder until pages are authored in the Studio (phase 3). */
@Component({
  selector: 'app-about',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap page">
      <h1>About</h1>
      <p>This page will be written and published from the Studio.</p>
    </div>
  `,
  styles: `
    .page {
      padding-block: 3rem;
    }
  `,
})
export class About {}
