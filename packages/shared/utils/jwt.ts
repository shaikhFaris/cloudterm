import jwt from 'jsonwebtoken';

export type JWTPayload = { id: string };

export const generateToken = async (payload: JWTPayload, secret: string, expiryTime: number) => {
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: expiryTime / 1000 });
};
