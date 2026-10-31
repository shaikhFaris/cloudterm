'use client';

import { api } from './api-client';
import type { AuthUser } from './auth-types';

export type { AuthUser } from './auth-types';

export async function getCurrentUser(signal?: AbortSignal): Promise<AuthUser> {
  const { data } = await api.get<AuthUser>('/auth/check', { signal });
  return data;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

export async function getGithubAuthorizationUrl(): Promise<string> {
  const { data } = await api.get<unknown>('/auth/github', { skipAuthRefresh: true });
  if (!data || typeof data !== 'object' || !('authorizationUrl' in data) ||
    typeof data.authorizationUrl !== 'string') {
    throw new Error('Unable to start GitHub sign-in. Please try again.');
  }
  const url = new URL(data.authorizationUrl);
  if (url.origin !== 'https://github.com' || url.pathname !== '/login/oauth/authorize' ||
    url.username || url.password) {
    throw new Error('Unable to start GitHub sign-in. Please try again.');
  }
  return url.toString();
}
