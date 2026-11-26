import type { Server as HttpServer } from 'node:http';
import { Server, type ServerOptions } from 'socket.io';
import { registerConnectionHandlers } from './sockets/connection-handler';
import { authMiddleware } from './sockets/middleware';

export function createSocketServer(
  httpServer: HttpServer,
  options: Partial<ServerOptions> = {},
): Server {
  const io = new Server(httpServer, options);
  console.log('Socket server created and ready for connections');

  io.use(authMiddleware);
  io.on('connection', registerConnectionHandlers);
  return io;
}
