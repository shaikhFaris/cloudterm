import type { Socket } from 'socket.io';
import logger from 'shared/utils/logger';
import z from 'zod';
import { exec, k8sApi } from '../k8s';
import { PassThrough } from 'node:stream';

export const terminalSchema = z.object({
  type: z.literal(['chars', 'resize']),
  input: z.string(),
  workspaceId: z.string(),
});

type TerminalType = z.infer<typeof terminalSchema>;

export async function registerConnectionHandlers(socket: Socket): Promise<void> {
  logger.info(`Socket connected: ${socket.id}`);

  const workspaceId = socket.handshake.auth?.workspaceId;

  if (!workspaceId) {
    console.log(socket.handshake.auth);

    console.error('workspaceId invalid');
    throw new Error('workspaceId invalid');
  }

  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  const ws = await exec.exec(
    'cloudterm',
    `workspace-${workspaceId}`,
    'terminal',
    ['/bin/sh'],
    stdout,
    stderr,
    stdin,
    true /* tty */,
    (status) => {
      console.log('Exited with status:');
      console.log(JSON.stringify(status, null, 2));
    },
  );

  // Kubernetes Pod → Browser
  stdout.on('data', (chunk: Buffer) => {
    console.log(chunk.toString());
    if (socket?.connected)
      socket.emit('terminal:output', {
        type: 'chars',
        input: chunk.toString(),
      });
  });
  // TODO: Register terminal session, input, and resize handlers here.

  socket.on('terminal:input', (data: TerminalType) => {
    try {
      const valid = terminalSchema.parse(data);
      console.log({
        raw: JSON.stringify(data.input),
        length: data.input.length,
        hex: Buffer.from(data.input).toString('hex'),
      });
      console.log('Recieved input in k8s-service: ', valid);

      // ks8-manager → Kubernetes Pod
      stdin.write(valid.input);
    } catch (error) {
      // handle errors in socket.emit
      console.error(error);
    }
  });

  socket.on('disconnect', (reason) => {
    // TODO: Close the associated terminal session.
    logger.info(`Socket disconnected: ${socket.id} (${reason})`);
    stdin.destroy();
    stdout.destroy();
    ws.close();
  });

  ws.on('close', () => {
    stdin.destroy();
    stdout.destroy();
    stderr.destroy();
  });

  ws.on('error', (error) => {
    logger.error('Kubernetes Exec WebSocket error', error);
  });

  socket.on('error', (error: Error) => {
    logger.error(`Socket error: ${socket.id}`, error);
  });
}
