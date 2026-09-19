import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-forbidden',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap page">
      <h1>Not permitted</h1>
      <p>Your account does not have access to this area.</p>
      <a routerLink="/">Back to the home page</a>
    </div>
  `,
  styles: `
    .page {
      padding-block: 3rem;
    }
  `,
})
export class Forbidden {}
