import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { getGithubAuthorizationUrl, getLoginError } from '../packages/web/lib/auth';

afterEach(() => mock.restore());

test('browser login fetches the same-origin gateway and navigates only to GitHub', async () => {
  const url = 'https://github.com/login/oauth/authorize?client_id=test&state=random';
  const request = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ authorizationUrl: url }));
  expect(await getGithubAuthorizationUrl()).toBe(url);
  expect(request).toHaveBeenCalledWith('/api/v1/auth/github', expect.objectContaining({
    headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store',
  }));
});

test('login rejects untrusted redirect destinations and malformed responses', async () => {
  const request = spyOn(globalThis, 'fetch');
  for (const authorizationUrl of ['https://evil.example/login', 'javascript:alert(1)',
    'https://github.com/other', 'https://user:password@github.com/login/oauth/authorize']) {
    request.mockResolvedValueOnce(Response.json({ authorizationUrl }));
    await expect(getGithubAuthorizationUrl()).rejects.toThrow();
  }
  request.mockResolvedValueOnce(Response.json({ accessToken: 'not-an-auth-url' }));
  await expect(getGithubAuthorizationUrl()).rejects.toThrow('Unable to start');
});

test('unavailable gateway and cancelled requests leave login retryable', async () => {
  const request = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(getGithubAuthorizationUrl()).rejects.toThrow('temporarily unavailable');
  request.mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
  await expect(getGithubAuthorizationUrl()).rejects.toThrow();
});

test('callback messages use fixed text rather than reflecting untrusted query content', () => {
  expect(getLoginError('github_denied')).toContain('cancelled');
  expect(getLoginError('github_conflict')).toContain('already exists');
  expect(getLoginError('<script>alert(1)</script>')).toBe('GitHub sign-in failed. Please try again.');
  expect(getLoginError('constructor')).toBe('GitHub sign-in failed. Please try again.');
  expect(getLoginError('__proto__')).toBe('GitHub sign-in failed. Please try again.');
  expect(getLoginError(undefined)).toBeUndefined();
});
