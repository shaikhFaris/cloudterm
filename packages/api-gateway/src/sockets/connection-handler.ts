import type { Socket } from 'socket.io';
import logger from 'shared/utils/logger';

export function registerConnectionHandlers(socket: Socket): void {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('terminal-message', (data) => console.log(data));

  socket.on('disconnect', (reason) => {
    logger.info(`Socket disconnected: ${socket.id} (${reason})`);
  });

  socket.on('error', (error: Error) => {
    logger.error(`Socket error: ${socket.id}`, error);
  });
}
