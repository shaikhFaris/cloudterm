import type { CookieOptions, RequestHandler } from 'express';
import { ApiError } from 'shared/utils/ApiError';
import logger from 'shared/utils/logger';
import { env } from '../../../config/validateEnvs';
import { clearAllCookies, setAllCookies } from '../../../utils/cookie';
import { beginGithubLogin, oauthLifetimeMs, validateGithubState } from './github-client';
import { loginWithGithub } from './github-services';

const getOAuthCookie = (): { name: string; options: CookieOptions } => {
  const production = env.NODE_ENV === 'prod';
  return {
    name: production ? '__Host-githubOAuth' : 'githubOAuth',
    options: {
      httpOnly: true, secure: production, sameSite: 'lax',
      // __Host- requires Secure, Path=/, and no Domain attribute.
      path: production ? '/' : '/api/v1/auth/github',
    },
  };
};

export const handleGithubLogin: RequestHandler = (req, res) => {
  const { cookie, url } = beginGithubLogin();
  const { name, options } = getOAuthCookie();
  res.set('Cache-Control', 'no-store');
  res.cookie(name, cookie, { ...options, maxAge: oauthLifetimeMs });
  res.vary('Accept');
  if (req.accepts(['html', 'json']) === 'json') {
    res.status(200).json({ authorizationUrl: url });
    return;
  }
  res.redirect(url);
};

export const handleGithubCallback: RequestHandler = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const { name, options } = getOAuthCookie();
  let failureCode = 'github_failed';
  try {
    failureCode = 'github_state';
    const verifier = validateGithubState(req.cookies?.[name], req.query.state);
    // An unsolicited invalid callback must not cancel a legitimate pending login.
    res.clearCookie(name, options);
    failureCode = 'github_failed';
    if (req.query.error !== undefined) {
      failureCode = 'github_denied';
      throw new ApiError(401, 'GitHub authorization was denied.');
    }
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
  } catch (error) {
    // Log fixed diagnostics only; never log callback codes, token payloads, or SQL parameters.
    if (error instanceof ApiError) {
      logger.warn(`GitHub sign-in failed: status=${error.status}; reason=${error.debugMsg}`);
    } else {
      const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
      const code = candidate?.cause?.code ?? candidate?.code;
      const safeCode = typeof code === 'string' && /^(?:[0-9A-Z]{5}|ECONNREFUSED|ETIMEDOUT)$/.test(code)
        ? code : 'unknown';
      logger.error(`GitHub sign-in failed unexpectedly: code=${safeCode}`);
    }
    if (!env.GITHUB_FAILURE_REDIRECT_URL) throw error;
    if (error instanceof ApiError) {
      if (error.status === 409) failureCode = 'github_conflict';
      if (error.status === 403) failureCode = 'github_email';
    } else {
      failureCode = 'github_failed';
    }
    const failureUrl = new URL(env.GITHUB_FAILURE_REDIRECT_URL);
    failureUrl.searchParams.set('error', failureCode);
    res.redirect(failureUrl.toString());
  }
};
