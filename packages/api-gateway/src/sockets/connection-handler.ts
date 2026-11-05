import type { Socket } from 'socket.io';
import logger from 'shared/utils/logger';
import { terminalAccess, socketError, requireRunningLab } from './authorization';
import { checkAuth } from '../modules/auth/auth-services';
import { sessionEvents, sessionEventKey } from '../modules/auth/session-events';
import { ApiError } from 'shared/utils/ApiError';

export function registerConnectionHandlers(socket: Socket): void {
  const access = terminalAccess.get(socket);
  if (!access) { socket.disconnect(true); return; }
  logger.info(`Socket connected: ${socket.id}`);

  let closed = false;
  let validating = false;
  const close = (error: unknown) => {
    if (closed) return;
    socket.emit('terminal:error', socketError(error).data);
    socket.disconnect(true);
  };
  const expired = () => {
    if (access.sessionExpiresAt <= Date.now()) return new ApiError(401, 'Session expired.');
    if (access.labExpiresAt <= Date.now()) return new ApiError(410, 'Lab expired.');
    return null;
  };
  let deadline: ReturnType<typeof setTimeout>;
  const armDeadline = () => {
    clearTimeout(deadline);
    deadline = setTimeout(() => {
      const error = expired();
      if (error) close(error); else armDeadline();
    }, Math.min(2_147_483_647, Math.max(0, Math.min(access.sessionExpiresAt, access.labExpiresAt) - Date.now())));
    deadline.unref();
  };
  const revoke = () => close(new ApiError(401, 'Session revoked.'));
  const sessionKey = sessionEventKey(access.refreshToken);
  sessionEvents.on(sessionKey, revoke);
  const recheck = setInterval(async () => {
    if (closed || validating) return;
    validating = true;
    try {
      await checkAuth(access.userId, access.refreshToken);
      const expiry = await requireRunningLab(access.userId, access.labId);
      if (!closed) { access.labExpiresAt = expiry; armDeadline(); }
    } catch (error) { close(error); }
    finally { validating = false; }
  }, 5_000);
  recheck.unref();

  socket.use((_packet, next) => {
    const error = expired();
    if (error) { close(error); next(socketError(error)); return; }
    next();
  });
  // The manager's exec bridge is still a scaffold. Never log user terminal input.
  const unavailable = () => socket.emit('terminal:error', { code: 'TERMINAL_NOT_IMPLEMENTED' });
  socket.on('terminal-message', unavailable);
  socket.on('terminal:input', unavailable);
  socket.on('terminal:resize', unavailable);

  socket.on('disconnect', (reason) => {
    closed = true;
    clearTimeout(deadline);
    clearInterval(recheck);
    sessionEvents.off(sessionKey, revoke);
    terminalAccess.delete(socket);
    logger.info(`Socket disconnected: ${socket.id} (${reason})`);
  });

  socket.on('error', () => {
    logger.error(`Socket error: ${socket.id}`);
  });
  armDeadline();
  const error = expired();
  if (error) close(error);
  else socket.emit('terminal:authorized', { labId: access.labId, expiresAt: new Date(access.labExpiresAt).toISOString() });
}
