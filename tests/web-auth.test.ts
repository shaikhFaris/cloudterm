import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { getGithubAuthorizationUrl, getCurrentUser, logout } from '../packages/web/lib/auth';
import { getLoginError } from '../packages/web/lib/auth-errors';
import { api } from '../packages/web/lib/api-client';

afterEach(() => mock.restore());

test('browser login uses the API client without attempting session renewal', async () => {
  const url = 'https://github.com/login/oauth/authorize?client_id=test&state=random';
  const request = spyOn(api, 'get').mockResolvedValue({ data: { authorizationUrl: url } });
  expect(await getGithubAuthorizationUrl()).toBe(url);
  expect(request).toHaveBeenCalledWith('/auth/github', { skipAuthRefresh: true });
});

test('login rejects untrusted redirect destinations and malformed responses', async () => {
  const request = spyOn(api, 'get');
  for (const authorizationUrl of ['https://evil.example/login', 'javascript:alert(1)',
    'https://github.com/other', 'https://user:password@github.com/login/oauth/authorize']) {
    request.mockResolvedValueOnce({ data: { authorizationUrl } });
    await expect(getGithubAuthorizationUrl()).rejects.toThrow();
  }
  request.mockResolvedValueOnce({ data: { accessToken: 'not-an-auth-url' } });
  await expect(getGithubAuthorizationUrl()).rejects.toThrow('Unable to start');
});

test('unavailable gateway and cancelled requests leave login retryable', async () => {
  const request = spyOn(api, 'get').mockRejectedValueOnce(new Error('Gateway unavailable'));
  await expect(getGithubAuthorizationUrl()).rejects.toThrow('Gateway unavailable');
  request.mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
  await expect(getGithubAuthorizationUrl()).rejects.toThrow();
});

test('current-user and logout requests use the authenticated API client', async () => {
  const controller = new AbortController();
  const user = { id: 'user-id', email: 'user@example.com' };
  const get = spyOn(api, 'get').mockResolvedValue({ data: user });
  const post = spyOn(api, 'post').mockResolvedValue({ status: 204 });
  expect(await getCurrentUser(controller.signal)).toEqual(user);
  expect(get).toHaveBeenCalledWith('/auth/check', { signal: controller.signal });
  await logout();
  expect(post).toHaveBeenCalledWith('/auth/logout');
});

test('callback messages use fixed text rather than reflecting untrusted query content', () => {
  expect(getLoginError('github_denied')).toContain('cancelled');
  expect(getLoginError('github_conflict')).toContain('already exists');
  expect(getLoginError('<script>alert(1)</script>')).toBe('GitHub sign-in failed. Please try again.');
  expect(getLoginError('constructor')).toBe('GitHub sign-in failed. Please try again.');
  expect(getLoginError('__proto__')).toBe('GitHub sign-in failed. Please try again.');
  expect(getLoginError(undefined)).toBeUndefined();
});
