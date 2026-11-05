import { parse } from 'cookie';
import z from 'zod';
import type { Socket } from 'socket.io';
import { ApiError } from 'shared/utils/ApiError';
import { verifySessionTokens } from '../modules/auth/session-tokens';
import { checkAuth } from '../modules/auth/auth-services';
import { findOwnedLabStatus } from '../modules/lab/lab-repository';

type Next = (error?: Error) => void;
const handshakeSchema = z.strictObject({ labId: z.uuid() });
export type TerminalAccess = { userId: string; refreshToken: string; sessionExpiresAt: number; labId: string; labExpiresAt: number };
// Credentials stay on the server and are never part of socket.data or emitted payloads.
export const terminalAccess = new WeakMap<Socket, TerminalAccess>();

export function socketError(error: unknown): Error & { data: { code: string } } {
  const status = error instanceof ApiError ? error.status : 503;
  const code = ({ 400: 'INVALID_LAB_ID', 401: 'AUTH_REQUIRED', 404: 'LAB_NOT_FOUND',
    409: 'LAB_NOT_READY', 410: 'LAB_EXPIRED' } as Record<number, string>)[status] ?? 'SERVICE_UNAVAILABLE';
  return Object.assign(new Error(code), { data: { code } });
}

export async function authenticateSocket(socket: Socket, next: Next) {
  try {
    const header = socket.handshake.headers.cookie;
    if (!header || Buffer.byteLength(header) > 16_384) throw new ApiError(401, 'Invalid cookies.');
    const cookies = parse(header);
    const session = verifySessionTokens(cookies.accessToken, cookies.refreshToken);
    await checkAuth(session.userId, session.refreshToken);
    terminalAccess.set(socket, { userId: session.userId, refreshToken: session.refreshToken,
      sessionExpiresAt: session.expiresAt, labId: '', labExpiresAt: 0 });
    next();
  } catch (error) { next(socketError(error)); }
}

export async function requireRunningLab(userId: string, labId: string) {
  const lab = await findOwnedLabStatus(userId, labId);
  if (!lab) throw new ApiError(404, 'Lab not found.');
  if (lab.status !== 'running') throw new ApiError(409, 'Lab is not running.');
  const expiry = lab.expiresAt?.getTime();
  if (!expiry || !Number.isFinite(expiry) || expiry <= Date.now()) throw new ApiError(410, 'Lab expired.');
  return expiry;
}

export async function authorizeLabSocket(socket: Socket, next: Next) {
  try {
    const access = terminalAccess.get(socket);
    if (!access || access.sessionExpiresAt <= Date.now()) throw new ApiError(401, 'Session expired.');
    const result = handshakeSchema.safeParse(socket.handshake.auth);
    if (!result.success) throw new ApiError(400, 'Invalid lab ID.');
    access.labId = result.data.labId;
    access.labExpiresAt = await requireRunningLab(access.userId, access.labId);
    next();
  } catch (error) { terminalAccess.delete(socket); next(socketError(error)); }
}
