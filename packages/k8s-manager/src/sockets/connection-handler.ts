import type { Socket } from 'socket.io';
import logger from 'shared/utils/logger';
import z from 'zod';
import { PassThrough } from 'node:stream';
import { exec } from '../k8s';
import { NAMESPACE } from '../k8sConfig';

const workspaceSchema = z.uuid();
const inputSchema = z.object({ type: z.literal('chars'), input: z.string(), workspaceId: workspaceSchema });

export async function registerConnectionHandlers(socket: Socket): Promise<void> {
  const workspace = workspaceSchema.safeParse(socket.handshake.auth.workspaceId);
  if (!workspace.success) {
    logger.warn('Rejected terminal connection with an invalid workspace ID');
    socket.emit('terminal:error', { code: 'TERMINAL_START_FAILED' });
    socket.disconnect(true);
    return;
  }

  const workspaceId = workspace.data;
  const stdin = new PassThrough();
  const stdout = new PassThrough().setEncoding('utf8');
  let ws: Awaited<ReturnType<typeof exec.exec>> | undefined;
  let closed = false;

  function abort(code: 'TERMINAL_START_FAILED' | 'TERMINAL_STREAM_FAILED') {
    if (closed || !socket.connected) return;
    logger.warn(`Terminal closed: ${socket.id} (${code})`);
    socket.emit('terminal:error', { code });
    socket.disconnect(true);
  }

  function exit(exitCode: number | null) {
    if (closed || !socket.connected) return;
    socket.emit('terminal:exit', { exitCode });
    socket.disconnect(true);
  }

  socket.once('disconnect', () => {
    closed = true;
    stdin.destroy();
    stdout.destroy();
    ws?.close();
    logger.info(`Terminal disconnected: ${socket.id}`);
  });
  socket.on('error', () => abort('TERMINAL_STREAM_FAILED'));
  stdin.on('error', () => abort('TERMINAL_STREAM_FAILED'));
  stdout.on('error', () => abort('TERMINAL_STREAM_FAILED'));

  stdout.on('data', (chunk: string) => {
    if (!closed && socket.connected) {
      socket.emit('terminal:output', { type: 'chars', input: chunk });
    }
  });

  socket.on('terminal:input', (payload: unknown) => {
    if (closed || !ws || ws.readyState !== ws.OPEN) return;
    const result = inputSchema.safeParse(payload);
    if (result.success && result.data.workspaceId === workspaceId) stdin.write(result.data.input);
  });

  try {
    ws = await exec.exec(
      NAMESPACE, `workspace-${workspaceId}`, 'terminal', ['/bin/sh'],
      stdout, null, stdin, true,
      (status) => {
        if (status.status === 'Success') {
          exit(0);
          return;
        }

        const value = status.details?.causes?.find((cause) => cause.reason === 'ExitCode')?.message;
        const exitCode = value === undefined ? NaN : Number(value);
        if (Number.isSafeInteger(exitCode) && exitCode >= 0) exit(exitCode);
        else abort(ws ? 'TERMINAL_STREAM_FAILED' : 'TERMINAL_START_FAILED');
      },
    );

    ws.on('error', () => abort('TERMINAL_STREAM_FAILED'));
    ws.once('close', (code) => {
      if (code === 1000) exit(null);
      else abort('TERMINAL_STREAM_FAILED');
    });
    if (closed) {
      ws.close();
      return;
    }
    if (ws.readyState !== ws.OPEN) {
      abort('TERMINAL_START_FAILED');
      return;
    }
    logger.info(`Terminal ready: ${socket.id}`);
    socket.emit('terminal:ready');
  } catch {
    abort('TERMINAL_START_FAILED');
  }
}
