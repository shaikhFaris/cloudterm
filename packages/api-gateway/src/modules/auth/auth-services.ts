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
    if (!user) throw new ApiError(400, 'Authentication failed');

    // check password
    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) throw new ApiError(400, 'Authentication failed');

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
  });
};

export const logout = async (refreshToken: string) => {
  await deleteRefreshToken(refreshToken);
};

export const refresh = async (refreshToken: string) => {
  try {
    const decodedRefreshToken = jwt.verify(
      refreshToken,
      env.JWT_REFRESH_TOKEN_SECRET,
    ) as JWTPayload;

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
