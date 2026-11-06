import type { Server as HttpServer } from 'node:http';
import { Server, type ServerOptions } from 'socket.io';
import { registerConnectionHandlers } from './sockets/connection-handler';
import { authenticateSocket, authorizeLabSocket } from './sockets/authorization';
import { env } from './config/validateEnvs';
import { io, type Socket } from 'socket.io-client';

export function createSocketServer(
  httpServer: HttpServer,
  options: Partial<ServerOptions> = {},
): Server {
  const configuredOrigin =
    env.FRONTEND_ORIGIN ??
    env.GITHUB_SUCCESS_REDIRECT_URL ??
    (env.NODE_ENV === 'dev' ? 'http://localhost:3000' : undefined);
  if (!configuredOrigin) throw new Error('FRONTEND_ORIGIN is required for terminal connections.');
  const origin = new URL(configuredOrigin);
  if (
    origin.username ||
    origin.password ||
    (env.NODE_ENV === 'prod' && origin.protocol !== 'https:')
  ) {
    throw new Error('Invalid terminal frontend origin.');
  }
  const io = new Server(httpServer, {
    ...options,
    cors: { origin: origin.origin, credentials: true },
    allowRequest: (req, callback) => callback(null, req.headers.origin === origin.origin),
    connectionStateRecovery: undefined,
    maxHttpBufferSize: 16_384,
  });
  io.use(authenticateSocket);
  io.use(authorizeLabSocket);
  io.on('connection', registerConnectionHandlers);
  return io;
}

export const connectK8sManager = (): Promise<Socket> => {
  return new Promise((resolve, reject) => {
    const socket = io(process.env.K8S_MANAGER_URL!, {
      auth: {
        apiKey: process.env.SHARED_KEY,
      },
      transports: ['websocket'],
      reconnection: true,
      timeout: 5000,
    });

    socket.once('connect', () => {
      resolve(socket);
    });

    socket.once('connect_error', (error) => {
      socket.disconnect();
      reject(error);
    });
  });
};
