import type { Socket } from 'socket.io';
import logger from 'shared/utils/logger';

export function registerConnectionHandlers(socket: Socket): void {
  logger.info(`Socket connected: ${socket.id}`);

  // TODO: Register terminal session, input, and resize handlers here.

  socket.on('disconnect', (reason) => {
    // TODO: Close the associated terminal session.
    logger.info(`Socket disconnected: ${socket.id} (${reason})`);
  });

  socket.on('error', (error: Error) => {
    logger.error(`Socket error: ${socket.id}`, error);
  });
}
