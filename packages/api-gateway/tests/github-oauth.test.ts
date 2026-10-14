import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';
import type { Transaction } from '../src/types/db';

Object.assign(process.env, {
  NODE_ENV: 'dev', PORT: '3001', COOKIE_DOMAIN: 'localhost',
  JWT_ACCESS_TOKEN_SECRET: 'test-access-secret', JWT_ACCESS_TOKEN_TIME_IN_MS: '60000',
  JWT_REFRESH_TOKEN_SECRET: 'test-refresh-secret', JWT_REFRESH_TOKEN_TIME_IN_MS: '120000',
  DB_URL: 'postgresql://test:test@localhost:5432/test',
  GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret',
  GITHUB_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/github/callback',
});

const client = await import('../src/modules/auth/github/github-client');
const repository = await import('../src/modules/auth/github/github-repository');
const authRepository = await import('../src/modules/auth/auth-repository');
const { loginWithGithub } = await import('../src/modules/auth/github/github-services');
const { handleGithubCallback } = await import('../src/modules/auth/github/github-controller');
const { logIn } = await import('../src/modules/auth/auth-services');
const { db } = await import('shared/db/drizzle');
const { env } = await import('../src/config/validateEnvs');
const { generateToken } = await import('shared/utils/jwt');
const { authenticateTokens } = await import('../src/middleware/authenticate-tokens');

afterEach(() => mock.restore());

function githubResponses(emails = [{ email: 'private@example.com', primary: true, verified: true }]) {
  return spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ access_token: 'github-token' }))
    .mockResolvedValueOnce(Response.json({ id: 123 }))
    .mockResolvedValueOnce(Response.json(emails));
}

const user = { id: 'user-id', email: 'private@example.com', githubId: '123', password: null, createdAt: new Date() };

describe('GitHub OAuth', () => {
  test('session JWT expiration uses the configured milliseconds', async () => {
    const token = await generateToken({ id: user.id }, env.JWT_ACCESS_TOKEN_SECRET, 60000);
    const claims = jwt.verify(token, env.JWT_ACCESS_TOKEN_SECRET) as jwt.JwtPayload;
    expect(claims.exp! - claims.iat!).toBe(60);
    expect(() => jwt.verify(token, env.JWT_ACCESS_TOKEN_SECRET, { clockTimestamp: claims.iat! + 61 })).toThrow();
  });

  test('authentication rejects mixed users, missing identity, and unexpected algorithms', () => {
    for (const accessToken of [
      jwt.sign({ id: 'another-user' }, env.JWT_ACCESS_TOKEN_SECRET),
      jwt.sign({}, env.JWT_ACCESS_TOKEN_SECRET),
      jwt.sign({ id: user.id }, env.JWT_ACCESS_TOKEN_SECRET, { algorithm: 'HS384' }),
    ]) {
      const next = mock();
      expect(() => authenticateTokens({ cookies: {
        accessToken, refreshToken: jwt.sign({ id: user.id }, env.JWT_REFRESH_TOKEN_SECRET),
      } } as unknown as Request, {} as Response, next)).toThrow('Invalid tokens');
      expect(next).not.toHaveBeenCalled();
    }
  });

  test('authentication accepts matching valid session tokens', async () => {
    const req = { cookies: {
      accessToken: await generateToken({ id: user.id }, env.JWT_ACCESS_TOKEN_SECRET, 60000),
      refreshToken: await generateToken({ id: user.id }, env.JWT_REFRESH_TOKEN_SECRET, 120000),
    } } as unknown as Request;
    const next = mock();
    authenticateTokens(req, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.id).toBe(user.id);
  });
  test('binds random state and the PKCE challenge to an expiring browser cookie', () => {
    const flow = client.beginGithubLogin();
    const url = new URL(flow.url);
    const verifier = client.validateGithubState(flow.cookie, url.searchParams.get('state'));
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(url.searchParams.get('scope')).toBe('user:email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(client.beginGithubLogin().cookie).not.toBe(flow.cookie);
    expect(() => jwt.verify(flow.cookie, env.JWT_ACCESS_TOKEN_SECRET)).toThrow();
  });

  test('rejects missing, mismatched, tampered, and expired state', () => {
    const flow = client.beginGithubLogin();
    const state = new URL(flow.url).searchParams.get('state');
    for (const [cookie, value] of [[undefined, state], [flow.cookie, undefined], [flow.cookie, 'wrong'], [`${flow.cookie}x`, state]]) {
      expect(() => client.validateGithubState(cookie, value)).toThrow('Invalid or expired');
    }
    const expired = jwt.sign({ state, verifier: 'test' },
      createHmac('sha256', env.JWT_ACCESS_TOKEN_SECRET).update('github-oauth').digest(),
      { audience: 'github-oauth', expiresIn: -1 });
    expect(() => client.validateGithubState(expired, state)).toThrow('Invalid or expired');
  });

  test('exchanges the code with PKCE and reads private verified email', async () => {
    const fetchMock = githubResponses();
    expect(await client.getGithubIdentity('code', 'verifier')).toEqual({ githubId: '123', email: user.email });
    const body = fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get('code_verifier')).toBe('verifier');
    expect(body.get('redirect_uri')).toBe(env.GITHUB_CALLBACK_URL!);
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://api.github.com/user/emails');
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  test('rejects unverified primary email', async () => {
    githubResponses([{ email: user.email, primary: true, verified: false }]);
    await expect(client.getGithubIdentity('code', 'verifier')).rejects.toThrow('verified primary');
  });

  test('handles provider denial and network failures without leaking responses', async () => {
    const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: 'bad_verification_code' }));
    await expect(client.getGithubIdentity('code', 'verifier')).rejects.toThrow('GitHub authorization failed');
    fetchMock.mockRejectedValueOnce(new Error('sensitive upstream detail'));
    await expect(client.getGithubIdentity('code', 'verifier')).rejects.toThrow('GitHub authentication request failed');
  });

  test('rejects malformed JSON and non-success GitHub responses', async () => {
    const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('invalid JSON'));
    await expect(client.getGithubIdentity('code', 'verifier')).rejects.toThrow('request failed');
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    await expect(client.getGithubIdentity('code', 'verifier')).rejects.toThrow('request failed');
  });

  test('invalid callback state clears the cookie and never calls GitHub', async () => {
    const fetchMock = spyOn(globalThis, 'fetch');
    const res = { set: mock(), clearCookie: mock() };
    await expect(handleGithubCallback({ cookies: {}, query: { code: 'code' } } as unknown as Request, res as unknown as Response, mock())).rejects.toThrow('Invalid or expired');
    expect(res.clearCookie).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('creates an OAuth account and issues the existing session tokens', async () => {
    spyOn(client, 'getGithubIdentity').mockResolvedValue({ githubId: '123', email: user.email });
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback({} as Transaction));
    spyOn(repository, 'findUserByGithubId').mockResolvedValue(undefined);
    spyOn(repository, 'addGithubUser').mockResolvedValue(user);
    const saveToken = spyOn(authRepository, 'insertOrUpdateRefreshToken').mockResolvedValue(undefined);
    const session = await loginWithGithub('code', 'verifier');
    expect(session.accountInfo).toEqual({ id: user.id, email: user.email });
    expect(jwt.verify(session.accessToken, env.JWT_ACCESS_TOKEN_SECRET)).toMatchObject({ id: user.id });
    expect(saveToken).toHaveBeenCalledWith(expect.anything(), session.refreshToken, user.id);
  });

  test('successful callback sets session cookies and returns account JSON', async () => {
    const previousRedirect = env.GITHUB_SUCCESS_REDIRECT_URL;
    env.GITHUB_SUCCESS_REDIRECT_URL = undefined;
    try {
      const flow = client.beginGithubLogin();
      spyOn(client, 'getGithubIdentity').mockResolvedValue({ githubId: '123', email: user.email });
      spyOn(db, 'transaction').mockImplementation(async (callback) => callback({} as Transaction));
      spyOn(repository, 'findUserByGithubId').mockResolvedValue(user);
      spyOn(authRepository, 'insertOrUpdateRefreshToken').mockResolvedValue(undefined);
      const res = { set: mock(), clearCookie: mock(), cookie: mock(), status: mock(), json: mock() };
      res.status.mockReturnValue(res);
      await handleGithubCallback({
        cookies: { githubOAuth: flow.cookie },
        query: { code: 'code', state: new URL(flow.url).searchParams.get('state') },
      } as unknown as Request, res as unknown as Response, mock());
      expect(res.cookie).toHaveBeenCalledWith('accessToken', expect.any(String), expect.objectContaining({ httpOnly: true }));
      expect(res.cookie).toHaveBeenCalledWith('refreshToken', expect.any(String), expect.objectContaining({ httpOnly: true }));
      expect(res.json).toHaveBeenCalledWith({ id: user.id, email: user.email });
    } finally {
      env.GITHUB_SUCCESS_REDIRECT_URL = previousRedirect;
    }
  });

  test('valid state with denied authorization or missing code never calls GitHub', async () => {
    const fetchMock = spyOn(globalThis, 'fetch');
    const flow = client.beginGithubLogin();
    const state = new URL(flow.url).searchParams.get('state');
    for (const query of [{ state, error: 'access_denied' }, { state }]) {
      const res = { set: mock(), clearCookie: mock() };
      await expect(handleGithubCallback({ cookies: { githubOAuth: flow.cookie }, query } as unknown as Request,
        res as unknown as Response, mock())).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns the existing GitHub account even after a GitHub email change', async () => {
    spyOn(client, 'getGithubIdentity').mockResolvedValue({ githubId: '123', email: 'changed@example.com' });
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback({} as Transaction));
    spyOn(repository, 'findUserByGithubId').mockResolvedValue(user);
    const insert = spyOn(repository, 'addGithubUser');
    spyOn(authRepository, 'insertOrUpdateRefreshToken').mockResolvedValue(undefined);
    expect((await loginWithGithub('code', 'verifier')).accountInfo.id).toBe(user.id);
    expect(insert).not.toHaveBeenCalled();
  });

  test('rejects email conflicts instead of linking a password account', async () => {
    spyOn(client, 'getGithubIdentity').mockResolvedValue({ githubId: '123', email: user.email });
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback({} as Transaction));
    spyOn(repository, 'findUserByGithubId').mockResolvedValue(undefined);
    spyOn(repository, 'addGithubUser').mockResolvedValue(undefined);
    await expect(loginWithGithub('code', 'verifier')).rejects.toThrow('already exists');
  });

  test('recovers when another callback creates the same GitHub account first', async () => {
    spyOn(client, 'getGithubIdentity').mockResolvedValue({ githubId: '123', email: user.email });
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback({} as Transaction));
    spyOn(repository, 'findUserByGithubId').mockResolvedValueOnce(undefined).mockResolvedValueOnce(user);
    spyOn(repository, 'addGithubUser').mockResolvedValue(undefined);
    spyOn(authRepository, 'insertOrUpdateRefreshToken').mockResolvedValue(undefined);
    expect((await loginWithGithub('code', 'verifier')).accountInfo.id).toBe(user.id);
  });

  test('OAuth-only users cannot log in with a password', async () => {
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback({} as Transaction));
    spyOn(authRepository, 'findUserByEmail').mockResolvedValue(user);
    await expect(logIn(user.email, 'some-password')).rejects.toThrow('Authentication failed');
  });
});
