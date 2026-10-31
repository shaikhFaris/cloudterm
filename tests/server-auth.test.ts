import { expect, mock, test } from 'bun:test';
import { AuthServiceUnavailableError, checkSession, renewSession } from '../packages/web/lib/server/auth-client-core';
import { getAuthReturnPath, getRenewalLocation, getRenewedLocation, hasRecentRenewal } from '../packages/web/lib/server/auth-redirects';
import { handleSessionRefresh } from '../packages/web/lib/server/refresh-handler';

const gatewayUrl = 'http://127.0.0.1:3500';
const appOrigin = 'https://cloudterm.example';

test('server checks forward only encoded session cookies and return minimal user information', async () => {
  const upstream = mock(async () => Response.json({ id: 'user-1', email: 'user@example.com',
    password: 'must-not-reach-the-client', accessToken: 'private' }));
  const user = await checkSession({ accessToken: 'access', refreshToken: 'refresh\r\nInjected: secret' },
    { gatewayUrl, fetch: upstream as typeof fetch });
  expect(user).toEqual({ id: 'user-1', email: 'user@example.com' });
  const [url, options] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.toString()).toBe('http://127.0.0.1:3500/api/v1/auth/check');
  expect(options.headers).toEqual({ Accept: 'application/json', Cookie: 'accessToken=access; refreshToken=refresh%0D%0AInjected%3A%20secret' });
  expect(options.cache).toBe('no-store');
  expect(options.redirect).toBe('error');
});

test('missing or oversized session cookies are unauthenticated without a backend request', async () => {
  const upstream = mock();
  expect(await checkSession({}, { gatewayUrl, fetch: upstream as typeof fetch })).toBeNull();
  expect(await checkSession({ refreshToken: 'refresh' }, { gatewayUrl, fetch: upstream as typeof fetch })).toBeNull();
  expect(await checkSession({ accessToken: 'x'.repeat(4097), refreshToken: 'refresh' },
    { gatewayUrl, fetch: upstream as typeof fetch })).toBeNull();
  expect(upstream).not.toHaveBeenCalled();
});

test('only a 401 is treated as unauthenticated; other errors fail closed', async () => {
  for (const status of [401, 403, 404, 500, 503]) {
    const upstream = mock(async () => new Response(null, { status }));
    const result = checkSession({ accessToken: 'access', refreshToken: 'refresh' },
      { gatewayUrl, fetch: upstream as typeof fetch });
    if (status === 401) expect(await result).toBeNull();
    else await expect(result).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  }
});

test('malformed success responses and connection failures do not expose upstream errors', async () => {
  for (const upstream of [
    mock(async () => Response.json({ authenticated: true })),
    mock(async () => new Response('invalid JSON')),
    mock(async () => { throw new Error('private request Cookie: secret'); }),
  ]) {
    await expect(checkSession({ accessToken: 'access', refreshToken: 'refresh' },
      { gatewayUrl, fetch: upstream as typeof fetch })).rejects.toThrow('Unable to verify your session. Please try again.');
  }
});

test('requests for different users have independent cookie headers and results', async () => {
  const upstream = mock(async (_url: unknown, options?: RequestInit) => {
    const cookie = new Headers(options?.headers).get('Cookie');
    const id = cookie?.includes('accessToken=first') ? 'first' : 'second';
    return Response.json({ id, email: `${id}@example.com` });
  });
  const [first, second] = await Promise.all([
    checkSession({ accessToken: 'first', refreshToken: 'one' }, { gatewayUrl, fetch: upstream as typeof fetch }),
    checkSession({ accessToken: 'second', refreshToken: 'two' }, { gatewayUrl, fetch: upstream as typeof fetch }),
  ]);
  expect(first?.id).toBe('first');
  expect(second?.id).toBe('second');
  expect(upstream).toHaveBeenCalledTimes(2);
});

test('invalid gateway configuration cannot receive session cookies', async () => {
  const upstream = mock();
  for (const invalid of ['file:///etc/passwd', 'https://user:secret@example.com', 'https://example.com/?target=other', 'https://example.com/path']) {
    await expect(checkSession({ accessToken: 'access', refreshToken: 'refresh' },
      { gatewayUrl: invalid, fetch: upstream as typeof fetch })).rejects.toBeInstanceOf(AuthServiceUnavailableError);
  }
  expect(upstream).not.toHaveBeenCalled();
});

test('renewal forwards only session Set-Cookie headers and requires an HttpOnly access cookie', async () => {
  const headers = new Headers();
  headers.append('Set-Cookie', 'accessToken=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  headers.append('Set-Cookie', 'accessToken=renewed; Path=/; HttpOnly; Secure; SameSite=Lax');
  headers.append('Set-Cookie', 'unrelated=ignore; Path=/');
  const upstream = mock(async () => new Response(null, { status: 200, headers }));
  const cookies = await renewSession('refresh', { gatewayUrl, fetch: upstream as typeof fetch });
  expect(cookies).toHaveLength(2);
  expect(cookies?.every((cookie) => cookie.startsWith('accessToken='))).toBe(true);
  const options = (upstream.mock.calls[0] as unknown as [unknown, RequestInit])[1];
  expect(options.method).toBe('POST');
  expect(options.headers).toEqual({ Accept: 'application/json', Cookie: 'refreshToken=refresh' });
  const invalid = mock(async () => new Response(null, { headers: { 'Set-Cookie': 'accessToken=unsafe; Path=/' } }));
  await expect(renewSession('refresh', { gatewayUrl, fetch: invalid as typeof fetch })).rejects.toBeInstanceOf(AuthServiceUnavailableError);
});

function refreshRequest(origin = appOrigin, returnTo = '/dashboard/new-labs', site = 'same-origin') {
  return new Request(`${appOrigin}/auth/refresh`, {
    method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': site },
    body: new URLSearchParams({ returnTo }),
  });
}

test('renewal rejects cross-origin and same-site sibling requests before contacting the gateway', async () => {
  const upstream = mock();
  for (const request of [refreshRequest('https://evil.example'), refreshRequest(appOrigin, '/dashboard', 'same-site'),
    new Request(`${appOrigin}/auth/refresh`, { method: 'POST', body: new URLSearchParams() }),
    new Request(`${appOrigin}/auth/refresh`)]) {
    const response = await handleSessionRefresh(request, { gatewayUrl, appOrigin, refreshToken: 'refresh', fetch: upstream as typeof fetch });
    expect(response.status).toBe(403);
  }
  expect(upstream).not.toHaveBeenCalled();
});

test('successful renewal sets cookies on a 303 response and returns only to an allowed page', async () => {
  const upstream = mock(async () => new Response(null, { headers: {
    'Set-Cookie': 'accessToken=new; Path=/; HttpOnly; Secure; SameSite=Lax',
  } }));
  const response = await handleSessionRefresh(refreshRequest(), { gatewayUrl, appOrigin, refreshToken: 'refresh', fetch: upstream as typeof fetch });
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toMatch(/^\/dashboard\/new-labs\?authRenewed=\d{13}$/);
  expect(response.headers.getSetCookie()).toHaveLength(1);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('location')).not.toContain('accessToken');
});

test('renewal distinguishes expired sessions from backend outages without a redirect loop', async () => {
  const expired = mock(async () => new Response(null, { status: 401 }));
  const failed = mock(async () => new Response(null, { status: 503 }));
  const first = await handleSessionRefresh(refreshRequest(), { gatewayUrl, appOrigin, refreshToken: 'refresh', fetch: expired as typeof fetch });
  expect(first.headers.get('location')).toBe('/login?error=session_expired');
  const second = await handleSessionRefresh(refreshRequest(), { gatewayUrl, appOrigin, refreshToken: 'refresh', fetch: failed as typeof fetch });
  expect(second.headers.get('location')).toBe('/auth/renew?error=unavailable&returnTo=%2Fdashboard%2Fnew-labs');
  expect(second.headers.getSetCookie()).toHaveLength(0);
});

test('return destinations cannot be external, protocol-relative, or unrecognized routes', () => {
  for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', '/dashboard/../admin', '/admin', ['/dashboard']]) {
    expect(getAuthReturnPath(path)).toBe('/dashboard');
  }
  expect(getRenewalLocation('/dashboard/new-labs')).toBe('/auth/renew?returnTo=%2Fdashboard%2Fnew-labs');
  expect(getRenewedLocation('https://evil.example', 1_800_000_000_000)).toBe('/dashboard?authRenewed=1800000000000');
  expect(hasRecentRenewal('1800000000000', 1_800_000_000_500)).toBe(true);
  expect(hasRecentRenewal('1800000000000', 1_800_000_060_000)).toBe(false);
  expect(hasRecentRenewal('1800000000000', 1_700_000_000_000)).toBe(false);
  expect(hasRecentRenewal(['1800000000000'], 1_800_000_000_500)).toBe(false);
});
