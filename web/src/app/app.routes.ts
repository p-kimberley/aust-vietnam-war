import { Routes } from '@angular/router';
import { roleGuard } from './core/role.guard';
import { SiteLayout } from './layout/site-layout';

const site = "Australia's Vietnam War";

export const routes: Routes = [
  {
    path: '',
    component: SiteLayout,
    children: [
      { path: '', pathMatch: 'full', title: site, loadComponent: () => import('./pages/home').then((m) => m.Home) },
      { path: 'about', title: `About · ${site}`, loadComponent: () => import('./pages/about').then((m) => m.About) },
      { path: 'forbidden', title: `Not permitted · ${site}`, loadComponent: () => import('./pages/forbidden').then((m) => m.Forbidden) },
    ],
  },
  {
    path: 'battlemap',
    title: `Battle Map · ${site}`,
    loadComponent: () => import('./battlemap/battlemap').then((m) => m.Battlemap),
  },
  {
    path: 'studio',
    canActivate: [roleGuard('author')],
    title: `Studio · ${site}`,
    loadComponent: () => import('./studio/studio-shell').then((m) => m.StudioShell),
    children: [{ path: '', loadComponent: () => import('./studio/studio-home').then((m) => m.StudioHome) }],
  },
  {
    path: '**',
    component: SiteLayout,
    children: [{ path: '', title: `Not found · ${site}`, loadComponent: () => import('./pages/not-found').then((m) => m.NotFound) }],
  },
];
