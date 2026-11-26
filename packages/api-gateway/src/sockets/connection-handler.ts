import type { Socket } from 'socket.io';
import logger from 'shared/utils/logger';
import z from 'zod';
import { checkAuth } from '../modules/auth/auth-services';
import { sessionEvents, sessionEventKey } from '../modules/auth/session-events';
import { createK8sManagerSocket } from '../ws';
import { requireRunningLab, socketError, terminalAccess } from './authorization';

const inputSchema = z.object({ type: z.literal('chars'), input: z.string() });
const exitSchema = z.object({ exitCode: z.number().int().nonnegative().nullable() });
const managerErrorSchema = z.object({
  code: z.enum(['TERMINAL_START_FAILED', 'TERMINAL_STREAM_FAILED']),
});
const recheckInterval = 5_000;
const startupTimeout = 15_000;

export function registerConnectionHandlers(socket: Socket): void {
  const authorized = terminalAccess.get(socket);
  if (!authorized) {
    socket.emit('terminal:error', { code: 'AUTH_REQUIRED' });
    socket.disconnect(true);
    return;
  }

  const access = authorized;
  logger.info(`Socket connected: ${socket.id}`);
  const manager = createK8sManagerSocket(access.labId);
  const sessionKey = sessionEventKey(access.refreshToken);
  let ready = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let checkTimeout: ReturnType<typeof setTimeout> | undefined;

  function endWithError(code: string) {
    if (!socket.connected) return;
    logger.warn(`Terminal closed: ${socket.id} (${code})`);
    socket.emit('terminal:error', { code });
    socket.disconnect(true);
  }

  function hasTimeRemaining() {
    if (!socket.connected) return false;
    const now = Date.now();
    if (now >= access.sessionExpiresAt) endWithError('AUTH_REQUIRED');
    else if (now >= access.labExpiresAt) endWithError('LAB_EXPIRED');
    return socket.connected;
  }

  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    if (!hasTimeRemaining()) return;
    const deadline = Math.min(access.sessionExpiresAt, access.labExpiresAt);
    expiryTimer = setTimeout(scheduleExpiry, Math.min(deadline - Date.now(), 2_147_483_647));
  }

  async function recheckAccess() {
    if (checkTimeout || !hasTimeRemaining()) return false;
    checkTimeout = setTimeout(() => endWithError('SERVICE_UNAVAILABLE'), recheckInterval);
    try {
      await checkAuth(access.userId, access.refreshToken);
      if (!hasTimeRemaining()) return false;
      const labExpiresAt = await requireRunningLab(access.userId, access.labId);
      if (!hasTimeRemaining()) return false;
      access.labExpiresAt = Math.min(access.labExpiresAt, labExpiresAt);
      scheduleExpiry();
      return socket.connected;
    } catch (error) {
      endWithError(socketError(error).data.code);
      return false;
    } finally {
      clearTimeout(checkTimeout);
      checkTimeout = undefined;
    }
  }

  const logout = () => endWithError('AUTH_REQUIRED');
  const startupTimer = setTimeout(() => endWithError('TERMINAL_START_FAILED'), startupTimeout);
  const recheckTimer = setInterval(() => { void recheckAccess(); }, recheckInterval);

  socket.once('disconnect', (reason) => {
    clearTimeout(startupTimer);
    clearTimeout(expiryTimer);
    clearTimeout(checkTimeout);
    clearInterval(recheckTimer);
    sessionEvents.off(sessionKey, logout);
    terminalAccess.delete(socket);
    manager.removeAllListeners();
    manager.disconnect();
    logger.info(`Socket disconnected: ${socket.id} (${reason})`);
  });
  socket.on('error', () => endWithError('TERMINAL_STREAM_FAILED'));
  sessionEvents.on(sessionKey, logout);

  socket.on('terminal:input', (payload: unknown) => {
    if (!ready || !manager.connected || !hasTimeRemaining()) return;
    const result = inputSchema.safeParse(payload);
    if (result.success) manager.emit('terminal:input', { ...result.data, workspaceId: access.labId });
  });

  manager.on('terminal:output', (output: unknown) => {
    if (!hasTimeRemaining()) return;
    const result = inputSchema.safeParse(output);
    if (result.success) socket.emit('terminal:output', result.data);
  });
  manager.once('terminal:ready', () => {
    if (!hasTimeRemaining()) return;
    clearTimeout(startupTimer);
    ready = true;
    socket.emit('terminal:ready');
  });
  manager.once('terminal:exit', (payload: unknown) => {
    if (!hasTimeRemaining()) return;
    const result = exitSchema.safeParse(payload);
    socket.emit('terminal:exit', { exitCode: result.success ? result.data.exitCode : null });
    socket.disconnect(true);
  });
  manager.once('terminal:error', (payload: unknown) => {
    const result = managerErrorSchema.safeParse(payload);
    endWithError(result.success ? result.data.code : 'TERMINAL_STREAM_FAILED');
  });
  manager.once('connect_error', () => endWithError('TERMINAL_START_FAILED'));
  manager.once('disconnect', () => endWithError(ready ? 'TERMINAL_STREAM_FAILED' : 'TERMINAL_START_FAILED'));

  scheduleExpiry();
  // Catch revocation between the handshake's database checks and the logout listener.
  void recheckAccess().then((allowed) => {
    if (allowed && hasTimeRemaining()) manager.connect();
  });
}
