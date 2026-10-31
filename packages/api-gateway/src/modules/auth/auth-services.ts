import { db } from 'shared/db/drizzle';
import { usersTable } from 'shared/db/schema/schema';
import { ApiError } from 'shared/utils/ApiError';
import { hash } from 'bcrypt';
import logger from 'shared/utils/logger';
import {
  addNewUser,
  deleteRefreshToken,
  findUserByEmail,
  findUserByRefreshToken,
  insertOrUpdateRefreshToken,
} from './auth-repository';
import bcrypt from 'bcrypt';
import jwt, { JsonWebTokenError } from 'jsonwebtoken';
import { generateToken, type JWTPayload } from 'shared/utils/jwt';
import { env } from '../../config/validateEnvs';
import type { Transaction } from '../../types/db';

export const signIn = async (email: string, password: string) => {
  await db.transaction(async (tx) => {
    const user = await findUserByEmail(tx, email);

    if (user) throw new ApiError(409, 'User already registered');

    const hashedPass = await hash(password, 10);
    await addNewUser(tx, email, hashedPass);

    logger.info('user created successfully');
  });
};

export const logIn = async (email: string, password: string) => {
  return await db.transaction(async (tx) => {
    const user = await findUserByEmail(tx, email);

    // user does not exist
    if (!user?.password) throw new ApiError(400, 'Authentication failed');

    // check password
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) throw new ApiError(400, 'Authentication failed');

    return createSession(tx, user);
  });
};

export const checkAuth = async (userId: string, refreshToken: string) => {
  return await db.transaction(async (tx) => {
    const user = await findUserByRefreshToken(tx, refreshToken, userId);

    // user does not exist
    if (!user) throw new ApiError(401, 'User not authenticated.');

    return {
      id: user.id,
      email: user.email,
    };
  });
};

export const createSession = async (tx: Transaction, user: typeof usersTable.$inferSelect) => {
  const accessToken = await generateToken(
    {
      id: user.id,
    },
    env.JWT_ACCESS_TOKEN_SECRET,
    env.JWT_ACCESS_TOKEN_TIME_IN_MS,
  );
  const refreshToken = await generateToken(
    {
      id: user.id,
    },
    env.JWT_REFRESH_TOKEN_SECRET,
    env.JWT_REFRESH_TOKEN_TIME_IN_MS,
  );
  // store/update refresh token in db
  await insertOrUpdateRefreshToken(tx, refreshToken, user.id);
  const accountInfo = {
    id: user.id,
    email: user.email,
  };
  return { accessToken, refreshToken, accountInfo };
};

export const logout = async (refreshToken: string) => {
  await deleteRefreshToken(refreshToken);
};

export const refresh = async (refreshToken: string) => {
  try {
    const decodedRefreshToken = jwt.verify(refreshToken, env.JWT_REFRESH_TOKEN_SECRET, {
      algorithms: ['HS256'],
    }) as JWTPayload;

    if (typeof decodedRefreshToken.id !== 'string' || !decodedRefreshToken.id) {
      throw new ApiError(401, 'Invalid refresh token.');
    }

    // if refresh tokens are valid
    return db.transaction(async (tx) => {
      const user = await findUserByRefreshToken(tx, refreshToken, decodedRefreshToken.id);

      // user not found
      if (!user) throw new ApiError(401, 'Refresh key not found.');
      const accessToken = await generateToken(
        {
          id: user.id,
        },
        env.JWT_ACCESS_TOKEN_SECRET,
        env.JWT_ACCESS_TOKEN_TIME_IN_MS,
      );

      return { accessToken };
    });
  } catch (error) {
    if (error instanceof JsonWebTokenError) {
      throw new ApiError(401, 'Invalid refresh token.');
    }
    throw error;
  }
};
