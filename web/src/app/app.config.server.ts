import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { API_BASE } from './core/api';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // Server-side requests can't use a relative URL: talk to the API service directly.
    { provide: API_BASE, useFactory: () => `${process.env['API_INTERNAL_URL'] ?? 'http://localhost:5186'}/api` },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
