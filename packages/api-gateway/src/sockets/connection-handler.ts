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

  let client: ClientSocket | undefined;

  socket.on('disconnect', () => {
    client?.disconnect();
    terminalAccess.delete(socket);
  });

  socket.on('terminal:input', (data: TerminalType) => {
    try {
      const valid = terminalSchema.parse(data);
      console.log({
        raw: JSON.stringify(data.input),
        length: data.input.length,
        hex: Buffer.from(data.input).toString('hex'),
      });
      if (client?.connected) client.emit('terminal:input', valid);
    } catch (error) {
      // handle errors in socket.emit
      console.error(error);
    }
  });

  socket.on('terminal:output', (data: TerminalType) => {
    try {
      const valid = terminalSchema.parse(data);
      console.log(data);
      if (client?.connected) client.emit('terminal:output', valid);
    } catch (error) {
      // handle errors in socket.emit
      console.error(error);
    }
  });

  socket.on('error', (error) => {
    console.error(error.message);
  });

  // Gateway input logging works independently of the downstream manager.
  try {
    client = await connectK8sManager();
    if (!socket.connected) {
      client.disconnect();
      return;
    }
    console.log('connected to k8s-manager');
  } catch {
    console.warn('k8s-manager unavailable; terminal input is being logged by the gateway only');
  }
}
