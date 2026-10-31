import type { AuthUser } from '../auth-types';

export type SessionCookies = { accessToken?: string; refreshToken?: string };
export type AuthGatewayOptions = { gatewayUrl: string; fetch?: typeof fetch };

export class AuthServiceUnavailableError extends Error {
  constructor() {
    super('Unable to verify your session. Please try again.');
    this.name = 'AuthServiceUnavailableError';
  }
}

function validCookie(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096;
}

async function requestGateway(path: '/auth/check' | '/auth/refresh', cookieHeader: string,
  options: AuthGatewayOptions): Promise<Response> {
  try {
    const base = new URL(options.gatewayUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
      base.search || base.hash || base.pathname !== '/') throw new Error();
    const response = await (options.fetch ?? fetch)(new URL(`/api/v1${path}`, base), {
      method: path === '/auth/check' ? 'GET' : 'POST',
      headers: { Accept: 'application/json', Cookie: cookieHeader },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 401) {
      await response.body?.cancel();
      throw new Error();
    }
    return response;
  } catch {
    // Never propagate upstream errors that could include request headers or tokens.
    throw new AuthServiceUnavailableError();
  }
}

/** No persistent cache or shared refresh promise; credentials belong to one request. */
export async function checkSession(cookies: SessionCookies, options: AuthGatewayOptions): Promise<AuthUser | null> {
  if (!validCookie(cookies.accessToken) || !validCookie(cookies.refreshToken)) return null;
  const response = await requestGateway('/auth/check',
    `accessToken=${encodeURIComponent(cookies.accessToken)}; refreshToken=${encodeURIComponent(cookies.refreshToken)}`,
    options);
  if (response.status === 401) {
    await response.body?.cancel();
    return null;
  }
  try {
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('id' in data) || !('email' in data) ||
      typeof data.id !== 'string' || !data.id || typeof data.email !== 'string' || !data.email) throw new Error();
    return { id: data.id, email: data.email };
  } catch {
    throw new AuthServiceUnavailableError();
  }
}

export async function renewSession(refreshToken: string | undefined,
  options: AuthGatewayOptions): Promise<string[] | null> {
  if (!validCookie(refreshToken)) return null;
  const response = await requestGateway('/auth/refresh', `refreshToken=${encodeURIComponent(refreshToken)}`, options);
  await response.body?.cancel();
  if (response.status === 401) return null;
  // Forward only the gateway's session cookies; never expose JWTs through page props or URLs.
  const cookies = response.headers.getSetCookie().filter((cookie) =>
    cookie.startsWith('accessToken=') || cookie.startsWith('refreshToken='));
  if (!cookies.some((cookie) => /^accessToken=[^;]+/.test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(cookie))) {
    throw new AuthServiceUnavailableError();
  }
  return cookies;
}
