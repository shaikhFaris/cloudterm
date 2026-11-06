import type { Socket } from 'socket.io';
import { terminalAccess } from './authorization';
import { ApiError } from 'shared/utils/ApiError';
import z from 'zod';
import { connectK8sManager } from '../ws';
import { type Socket as ClientSocket } from 'socket.io-client';

export const terminalSchema = z.object({
  type: z.literal(['chars', 'resize']),
  input: z.string(),
});

type TerminalType = z.infer<typeof terminalSchema>;

export async function registerConnectionHandlers(socket: Socket): Promise<void> {
  const access = terminalAccess.get(socket);
  if (!access) throw new ApiError(400, 'Session expired');

  let client: ClientSocket;
  try {
    client = await connectK8sManager();
    console.log('connected to k8s-manager');
  } catch (error) {
    socket.disconnect(true);
    return;
  }

  socket.on('terminal:input', (data: TerminalType) => {
    try {
      console.log(data);
      const valid = terminalSchema.parse(data);
      client.emit('terminal:input', data);
    } catch (error) {
      // handle errors in socket.emit
      console.error(error);
    }
  });

  socket.on('terminal:output', (data: TerminalType) => {
    try {
      console.log(data);
      const valid = terminalSchema.parse(data);
      client.emit('terminal:output', data);
    } catch (error) {
      // handle errors in socket.emit
      console.error(error);
    }
  });

  socket.on('error', (error) => {
    console.error(error.message);
  });
}
