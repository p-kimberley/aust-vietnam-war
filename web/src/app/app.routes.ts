import { Routes } from '@angular/router';
import { cmsPageMatcher } from './content/cms-page';
import { roleGuard } from './core/role.guard';
import { SiteLayout } from './layout/site-layout';

const site = "Australia's Vietnam War";

/**
 * The map and Studio come first: the public layout below ends in a catch-all for authored pages (About, Team...),
 * which would otherwise claim their paths.
 */
export const routes: Routes = [
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
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'articles' },
      { path: 'articles', pathMatch: 'full', loadComponent: () => import('./studio/studio-articles').then((m) => m.StudioArticles) },
      { path: 'articles/:id', loadComponent: () => import('./studio/article-editor').then((m) => m.ArticleEditor) },
      { path: 'media', loadComponent: () => import('./studio/studio-media').then((m) => m.StudioMedia) },
    ],
  },
  {
    path: '',
    component: SiteLayout,
    children: [
      { path: '', pathMatch: 'full', title: site, loadComponent: () => import('./pages/home').then((m) => m.Home) },
      { path: 'articles', pathMatch: 'full', loadComponent: () => import('./content/article-list').then((m) => m.ArticleList) },
      { path: 'articles/:slug', loadComponent: () => import('./content/article-page').then((m) => m.ArticlePage) },
      { path: 'forbidden', title: `Not permitted · ${site}`, loadComponent: () => import('./pages/forbidden').then((m) => m.Forbidden) },
      // Anything else is looked up as an authored page; the page shows Not found (and a 404 status) if there is none.
      { matcher: cmsPageMatcher, loadComponent: () => import('./content/cms-page').then((m) => m.CmsPage) },
    ],
  },
  {
    path: '**',
    component: SiteLayout,
    children: [{ path: '', title: `Not found · ${site}`, loadComponent: () => import('./pages/not-found').then((m) => m.NotFound) }],
  },
];
