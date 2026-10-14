import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import z from 'zod';
import { ApiError } from 'shared/utils/ApiError';
import { env } from '../../../config/validateEnvs';

const oauthAudience = 'github-oauth';
const stateSecret = () => createHmac('sha256', env.JWT_ACCESS_TOKEN_SECRET).update(oauthAudience).digest();
export const oauthLifetimeMs = 10 * 60 * 1000;

const getConfig = () => {
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_CALLBACK_URL } = env;
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_CALLBACK_URL) {
    throw new ApiError(503, 'GitHub login is not configured.');
  }
  return { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET, callbackUrl: GITHUB_CALLBACK_URL };
};

export const beginGithubLogin = () => {
  const config = getConfig();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const cookie = jwt.sign({ state, verifier }, stateSecret(), {
    algorithm: 'HS256', audience: oauthAudience, expiresIn: oauthLifetimeMs / 1000,
  });
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.callbackUrl, scope: 'user:email',
    state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return { cookie, url: url.toString() };
};

export const validateGithubState = (cookie: unknown, state: unknown) => {
  try {
    if (typeof cookie !== 'string' || typeof state !== 'string') throw new Error();
    const payload = z.object({ state: z.string(), verifier: z.string() }).parse(
      jwt.verify(cookie, stateSecret(), { algorithms: ['HS256'], audience: oauthAudience }),
    );
    const actual = Buffer.from(state);
    const expected = Buffer.from(payload.state);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    return payload.verifier;
  } catch {
    throw new ApiError(400, 'Invalid or expired GitHub OAuth state. Please try again.');
  }
};

const requestGithub = async (url: string, options: RequestInit): Promise<unknown> => {
  try {
    const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    throw new ApiError(502, 'GitHub authentication request failed. Please try again.');
  }
};

export const getGithubIdentity = async (code: string, verifier: string) => {
  const config = getConfig();
  const token = z.object({ access_token: z.string().min(1) }).safeParse(
    await requestGithub('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
        redirect_uri: config.callbackUrl, code, code_verifier: verifier }),
    }),
  );
  if (!token.success) throw new ApiError(401, 'GitHub authorization failed. Please try again.');
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token.data.access_token}`,
    'User-Agent': 'cloudterm-api-gateway', 'X-GitHub-Api-Version': '2022-11-28' };
  const profile = z.object({ id: z.number().int().positive() }).safeParse(
    await requestGithub('https://api.github.com/user', { headers }),
  );
  if (!profile.success) throw new ApiError(502, 'Invalid GitHub profile response.');
  const emails = z.array(z.object({ email: z.email(), primary: z.boolean(), verified: z.boolean() })).safeParse(
    await requestGithub('https://api.github.com/user/emails', { headers }),
  );
  if (!emails.success) throw new ApiError(502, 'Invalid GitHub email response.');
  const email = emails.data.find((entry) => entry.primary && entry.verified)?.email;
  if (!email) throw new ApiError(403, 'A verified primary GitHub email is required.');
  return { githubId: String(profile.data.id), email };
};
