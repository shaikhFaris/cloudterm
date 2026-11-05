import type { Socket } from 'socket.io';

export function authMiddleware(socket: Socket, next: (err?: Error) => void) {
  const apiKey = socket.handshake.auth.apiKey;

  if (typeof apiKey !== 'string' || apiKey !== process.env.SHARED_KEY) {
    return next(new Error('Unauthorized'));
  }

  next();
}
