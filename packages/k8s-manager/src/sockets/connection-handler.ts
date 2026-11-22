import type { Socket } from 'socket.io';
import logger from 'shared/utils/logger';
import z from 'zod';

export const terminalSchema = z.object({
  type: z.literal(['chars', 'resize']),
  input: z.string(),
});

type TerminalType = z.infer<typeof terminalSchema>;

export function registerConnectionHandlers(socket: Socket): void {
  logger.info(`Socket connected: ${socket.id}`);

  // TODO: Register terminal session, input, and resize handlers here.

  socket.on('terminal:input', (data: TerminalType) => {
    try {
      const valid = terminalSchema.parse(data);
      console.log({
        raw: JSON.stringify(data.input),
        length: data.input.length,
        hex: Buffer.from(data.input).toString('hex'),
      });
      if (socket?.connected) socket.emit('terminal:input', valid);
    } catch (error) {
      // handle errors in socket.emit
      console.error(error);
    }
  });

  socket.on('disconnect', (reason) => {
    // TODO: Close the associated terminal session.
    logger.info(`Socket disconnected: ${socket.id} (${reason})`);
  });

  socket.on('error', (error: Error) => {
    logger.error(`Socket error: ${socket.id}`, error);
  });
}
