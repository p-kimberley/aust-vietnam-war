import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, Role } from './auth.service';

/**
 * Requires `role` (or higher). Anonymous visitors are sent to Keycloak and come back to the page they wanted;
 * signed-in users without the role see the Forbidden page. This is a usability gate, not security: the API
 * authorises every request itself.
 */
export const roleGuard =
  (role: Role): CanActivateFn =>
  async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    const me = await auth.load();
    if (!me.authenticated) {
      auth.login(state.url);
      return false;
    }
    return auth.hasRole(role) ? true : router.createUrlTree(['/forbidden']);
  };
