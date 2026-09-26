import { ChangeDetectionStrategy, Component, afterNextRender, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ScrollMemory } from './core/scroll-memory';
import { InstallHint } from './layout/install-hint';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, InstallHint],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<router-outlet /><app-install-hint />',
})
export class App {
  constructor() {
    // Back to a page puts it where the reader left it (in the browser: the server has no scrolling).
    const scrollMemory = inject(ScrollMemory);
    afterNextRender(() => scrollMemory.start());
  }
}
