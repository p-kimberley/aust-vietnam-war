import { signal } from '@angular/core';
import { vi } from 'vitest';
import { AuthService, Me } from '../../core/auth.service';
import { CommunityService } from './community';

/** A community API that has nothing to show, and records what it is asked. Override methods per test. */
export function fakeCommunity(over: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  return {
    notes: vi.fn(() => Promise.resolve([])),
    media: vi.fn(() => Promise.resolve([])),
    mediaOnMap: vi.fn(() => Promise.resolve([])),
    nearbyMedia: vi.fn(() => Promise.resolve([])),
    mediaDetail: vi.fn(() => Promise.reject(new Error('no such picture'))),
    casualties: vi.fn(() => Promise.resolve([])),
    person: vi.fn(() => Promise.reject(new Error('no such person'))),
    honourRoll: vi.fn(() => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 })),
    tributes: vi.fn(() => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 })),
    ...over,
  } as Record<string, ReturnType<typeof vi.fn>>;
}

/** A stand-in for the signed-in user. `roles` are the ones the user holds; higher roles imply lower ones, as in the real service. */
export function fakeAuth(me: Partial<Me> & { roles?: string[] } = {}) {
  const rank: Record<string, number> = { member: 0, author: 1, editor: 2, admin: 3 };
  const roles = me.roles ?? [];
  return {
    isAuthenticated: signal(me.authenticated ?? false),
    user: signal({ authenticated: me.authenticated ?? false, id: me.id ?? null, name: me.name ?? null, roles }),
    hasRole: (role: string) => roles.some((r) => rank[r] >= rank[role]),
    login: vi.fn(),
    loaded: signal(true),
  };
}

export const communityProviders = (community = fakeCommunity(), auth = fakeAuth()) => [
  { provide: CommunityService, useValue: community },
  { provide: AuthService, useValue: auth },
];
