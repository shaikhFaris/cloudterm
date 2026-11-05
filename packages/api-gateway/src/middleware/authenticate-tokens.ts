import { type RequestHandler } from 'express';
import { verifySessionTokens } from '../modules/auth/session-tokens';

export const authenticateTokens: RequestHandler = (req, _res, next) => {
  const session = verifySessionTokens(req.cookies?.accessToken, req.cookies?.refreshToken);
  req.user = { id: session.userId };
  req.refreshToken = session.refreshToken;
  next();
};
