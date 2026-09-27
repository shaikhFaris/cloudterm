import { type RequestHandler } from 'express';
import jwt, { JsonWebTokenError } from 'jsonwebtoken';
import { ApiError } from 'shared/utils/ApiError';
import { env } from '../config/validateEnvs';
import type { JWTPayload } from 'shared/utils/jwt';

export const authenticateTokens: RequestHandler = (req, res, next) => {
  try {
    const accessToken = req.cookies.accessToken;
    const refreshToken = req.cookies.refreshToken;
    if (!accessToken || !refreshToken) throw new ApiError(401, 'User not authenticated.');

    const decodedAccessToken = jwt.verify(accessToken, env.JWT_ACCESS_TOKEN_SECRET) as JWTPayload;

    const decodedRefreshToken = jwt.verify(
      refreshToken,
      env.JWT_REFRESH_TOKEN_SECRET,
    ) as JWTPayload;

    req.user = {
      id: decodedAccessToken.id,
    };
    req.refreshToken = refreshToken;
    next();
  } catch (error) {
    if (error instanceof JsonWebTokenError) {
      throw new ApiError(401, 'Invalid tokens.');
    }
    throw error;
  }
};
