import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Client-only: the map and the authoring studio depend on browser APIs and the signed-in session.
  { path: 'battlemap', renderMode: RenderMode.Client },
  { path: 'studio', renderMode: RenderMode.Client },
  { path: 'studio/**', renderMode: RenderMode.Client },
  // Public content is rendered per request so it always reflects what has been published.
  { path: '**', renderMode: RenderMode.Server },
];
