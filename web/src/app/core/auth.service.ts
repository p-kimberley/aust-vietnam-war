import { HttpClient } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';

export type Role = 'member' | 'author' | 'editor' | 'admin';

/** Higher index = more privileged. Mirrors the API's hierarchical policies. */
const RANK: Record<Role, number> = { member: 0, author: 1, editor: 2, admin: 3 };

export interface Me {
  authenticated: boolean;
  id: number | null;
  name: string | null;
  roles: Role[];
}

const ANONYMOUS: Me = { authenticated: false, id: null, name: null, roles: [] };

/**
 * Who is signed in. The session lives in an HttpOnly cookie owned by the API, so the app only ever learns
 * the display name and roles from `/api/auth/me`. Roles here drive the UI only; the API enforces them.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly state = signal<Me>(ANONYMOUS);
  private readonly loadedFlag = signal(false);
  private inflight?: Promise<Me>;

  readonly user = this.state.asReadonly();
  readonly isAuthenticated = computed(() => this.state().authenticated);
  /** False until the first `/api/auth/me` answer, so the UI can avoid flashing "Sign in". */
  readonly loaded = this.loadedFlag.asReadonly();

  /** Loads the current user once. On the server (SSR) nobody is signed in: pages render as anonymous. */
  load(): Promise<Me> {
    if (!this.isBrowser) {
      return Promise.resolve(ANONYMOUS);
    }
    this.inflight ??= firstValueFrom(this.http.get<Me>('/api/auth/me'))
      .catch(() => ANONYMOUS)
      .then((me) => {
        this.state.set(me);
        this.loadedFlag.set(true);
        return me;
      });
    return this.inflight;
  }

  /** True when the user has `role` or any role above it. */
  hasRole(role: Role): boolean {
    return this.state().roles.some((r) => RANK[r] >= RANK[role]);
  }

  login(returnUrl = location.pathname + location.search): void {
    location.assign(`/api/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  register(returnUrl = location.pathname + location.search): void {
    location.assign(`/api/auth/register?returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  async logout(): Promise<void> {
    const { redirectUrl } = await firstValueFrom(
      this.http.post<{ redirectUrl: string }>('/api/auth/logout', null),
    );
    this.state.set(ANONYMOUS);
    location.assign(redirectUrl);
  }
}
