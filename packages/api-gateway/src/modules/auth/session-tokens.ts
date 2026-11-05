import jwt, { JsonWebTokenError } from 'jsonwebtoken';
import { ApiError } from 'shared/utils/ApiError';
import { env } from '../../config/validateEnvs';

export function verifySessionTokens(accessToken: unknown, refreshToken: unknown) {
  if (typeof accessToken !== 'string' || !accessToken || typeof refreshToken !== 'string' || !refreshToken) {
    throw new ApiError(401, 'User not authenticated.');
  }
  try {
    const access = jwt.verify(accessToken, env.JWT_ACCESS_TOKEN_SECRET, { algorithms: ['HS256'] });
    const refresh = jwt.verify(refreshToken, env.JWT_REFRESH_TOKEN_SECRET, { algorithms: ['HS256'] });
    if (typeof access === 'string' || typeof refresh === 'string' ||
      typeof access.id !== 'string' || !access.id || access.id !== refresh.id ||
      typeof access.exp !== 'number' || typeof refresh.exp !== 'number') {
      throw new ApiError(401, 'Invalid tokens.');
    }
    return { userId: access.id, refreshToken, expiresAt: Math.min(access.exp, refresh.exp) * 1_000 };
  } catch (error) {
    if (error instanceof JsonWebTokenError) throw new ApiError(401, 'Invalid tokens.');
    throw error;
  }
}
