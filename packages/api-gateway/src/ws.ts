import type { Server as HttpServer } from 'node:http';
import { Server, type ServerOptions } from 'socket.io';
import { registerConnectionHandlers } from './sockets/connection-handler';

export function createSocketServer(
  httpServer: HttpServer,
  options: Partial<ServerOptions> = {},
): Server {
  const io = new Server(httpServer, options);
  io.on('connection', registerConnectionHandlers);
  return io;
}
