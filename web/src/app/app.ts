import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { InstallHint } from './layout/install-hint';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, InstallHint],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<router-outlet /><app-install-hint />',
})
export class App {}
