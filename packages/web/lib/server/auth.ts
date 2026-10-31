import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkSession } from './auth-client-core';
import { getAuthGatewayUrl } from './auth-config';
import { getRenewalLocation } from './auth-redirects';
import type { AuthUser } from '../auth-types';

/** React cache deduplicates only within this server render, never across users. */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  const cookieStore = await cookies();
  return checkSession({
    accessToken: cookieStore.get('accessToken')?.value,
    refreshToken: cookieStore.get('refreshToken')?.value,
  }, { gatewayUrl: getAuthGatewayUrl() });
});

/** Call before protected data access in every page, Server Action, or Route Handler. */
export async function requireUser(options: { returnTo?: string; allowRefresh?: boolean } = {}): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (user) return user;

  const cookieStore = await cookies();
  if (options.allowRefresh !== false && cookieStore.get('refreshToken')?.value) {
    redirect(getRenewalLocation(options.returnTo ?? '/dashboard'));
  }
  redirect('/login?error=session_expired');
}
