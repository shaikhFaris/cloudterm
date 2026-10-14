import type { CookieOptions, RequestHandler } from 'express';
import { ApiError } from 'shared/utils/ApiError';
import { env } from '../../../config/validateEnvs';
import { clearAllCookies, setAllCookies } from '../../../utils/cookie';
import { beginGithubLogin, oauthLifetimeMs, validateGithubState } from './github-client';
import { loginWithGithub } from './github-services';

const cookieName = 'githubOAuth';
const oauthCookieOptions: CookieOptions = {
  httpOnly: true, secure: env.NODE_ENV === 'prod', sameSite: 'lax',
  path: '/api/v1/auth/github',
};

export const handleGithubLogin: RequestHandler = (_req, res) => {
  const { cookie, url } = beginGithubLogin();
  res.set('Cache-Control', 'no-store');
  res.cookie(cookieName, cookie, { ...oauthCookieOptions, maxAge: oauthLifetimeMs });
  res.redirect(url);
};

export const handleGithubCallback: RequestHandler = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.clearCookie(cookieName, oauthCookieOptions);
  const verifier = validateGithubState(req.cookies?.[cookieName], req.query.state);
  if (req.query.error !== undefined) throw new ApiError(401, 'GitHub authorization was denied.');
  if (typeof req.query.code !== 'string' || !req.query.code) {
    throw new ApiError(400, 'GitHub authorization code is required.');
  }
  const { accessToken, refreshToken, accountInfo } = await loginWithGithub(req.query.code, verifier);
  clearAllCookies(res);
  setAllCookies(res, accessToken, refreshToken);
  if (env.GITHUB_SUCCESS_REDIRECT_URL) {
    res.redirect(env.GITHUB_SUCCESS_REDIRECT_URL);
    return;
  }
  res.status(200).json(accountInfo);
};
