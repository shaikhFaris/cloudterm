import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

export type JWTPayload = { id: string };

export const generateToken = async (payload: JWTPayload, secret: string, expiryTime: number) => {
  return jwt.sign(payload, secret, {
    algorithm: 'HS256', expiresIn: expiryTime / 1000, jwtid: randomUUID(),
  });
};
