import { type RequestHandler } from 'express';
import type z from 'zod';
import type { loginSchema, signUpSchema } from './auth-schema';
import { logIn, logout, refresh, signIn } from './auth-services';
import { clearAllCookies, cookieOptions, setAllCookies } from '../../utils/cookie';
import { ApiError } from 'shared/utils/ApiError';
import { env } from '../../config/validateEnvs';

type SignUpBody = z.infer<typeof signUpSchema>;
type LoginBody = z.infer<typeof loginSchema>;

//request handlers automatically catch and pass the errors to the global error handlers
export const handleSignUp: RequestHandler = async (req, res) => {
  const {
    body: { email, password },
  } = req as SignUpBody;

  await signIn(email, password);

  res.status(201).json({
    message: 'User created successfully, Please login.',
  });
};

export const handleLogin: RequestHandler = async (req, res) => {
  const {
    body: { email, password },
  } = req as LoginBody;

  const { accessToken, refreshToken, accountInfo } = await logIn(email, password);

  clearAllCookies(res);
  setAllCookies(res, accessToken, refreshToken);

  res.status(200).json(accountInfo);
};

export const handleLogout: RequestHandler = async (req, res) => {
  if (!req.refreshToken) throw new ApiError(401, 'Invalid tokens. Login first.');

  await logout(req.refreshToken);

  clearAllCookies(res);

  res.status(204).json({
    message: 'Logged out.',
  });
};

export const handleRefresh: RequestHandler = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) throw new ApiError(401, 'Invalid tokens.');

  const { accessToken } = await refresh(refreshToken);

  res.clearCookie('accessToken');

  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    maxAge: env.JWT_ACCESS_TOKEN_TIME_IN_MS,
    ...cookieOptions,
  });
  res.json({
    message: 'Access token renewed.',
  });
};
