import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { API_BASE, ApiFetchBackend, provideApiRewrite } from './core/api';
import { SITE_URL } from './core/seo.service';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // Server-side requests can't use a relative URL: talk to the API service directly.
    { provide: API_BASE, useFactory: () => `${process.env['API_INTERNAL_URL'] ?? 'http://localhost:5186'}/api` },
    ApiFetchBackend,
    provideApiRewrite(),
    // Canonical links and Open Graph URLs must use the public address, not the pod's.
    { provide: SITE_URL, useFactory: () => (process.env['PUBLIC_URL'] ?? '').replace(/\/+$/, '') },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
