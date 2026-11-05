import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { Server, ServerOptions } from 'socket.io';
import logger from 'shared/utils/logger';
import jwt from 'jsonwebtoken';
Object.assign(process.env, {
  NODE_ENV: 'dev', PORT: '3001', COOKIE_DOMAIN: 'localhost', FRONTEND_ORIGIN: 'http://localhost:3000',
  JWT_ACCESS_TOKEN_SECRET: 'test-access-secret', JWT_ACCESS_TOKEN_TIME_IN_MS: '60000',
  JWT_REFRESH_TOKEN_SECRET: 'test-refresh-secret', JWT_REFRESH_TOKEN_TIME_IN_MS: '120000',
  DB_URL: 'postgresql://test:test@localhost:5432/test',
  GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret',
  GITHUB_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/github/callback',
});
const { createSocketServer } = await import('../src/ws');
const auth = await import('../src/modules/auth/auth-services');
const labs = await import('../src/modules/lab/lab-repository');
const { env } = await import('../src/config/validateEnvs');
const { sessionEvents, sessionEventKey } = await import('../src/modules/auth/session-events');
const userId = '83bcfe2d-bcaa-41e5-8b3a-4875ee43019a';
const labId = '4d3f5c21-cfde-4e53-a7d5-bf43a513d153';
const origin = 'http://localhost:3000';
let checkAuth: Mock<typeof auth.checkAuth>;
let findLab: Mock<typeof labs.findOwnedLabStatus>;
function credentials() {
  const access = jwt.sign({ id: userId }, env.JWT_ACCESS_TOKEN_SECRET, { expiresIn: 60 });
  const refresh = jwt.sign({ id: userId }, env.JWT_REFRESH_TOKEN_SECRET, { expiresIn: 120 });
  return { refresh, cookie: `accessToken=${access}; refreshToken=${refresh}` };
}

const servers: Server[] = [];
const httpServers: ReturnType<typeof createServer>[] = [];
const clients: WebSocket[] = [];
let infoLog: Mock<typeof logger.info>;

beforeEach(() => {
  env.FRONTEND_ORIGIN = origin;
  checkAuth = spyOn(auth, 'checkAuth').mockResolvedValue({ id: userId, email: 'test@example.com' });
  findLab = spyOn(labs, 'findOwnedLabStatus').mockResolvedValue({ labId, status: 'running', expiresAt: new Date(Date.now() + 60_000) });
  infoLog = spyOn(logger, 'info').mockImplementation(() => logger);
});

afterEach(async () => {
  const disconnections = servers.flatMap((io) =>
    Array.from(io.sockets.sockets.values()).map((socket) => once(socket, 'disconnect')),
  );
  clients.splice(0).forEach((client) => client.close());
  try {
    await Promise.all(disconnections);
    httpServers.splice(0).forEach((server) => server.closeAllConnections());
    await Promise.all(servers.splice(0).map((io) => new Promise<void>((resolve) => io.close(() => resolve()))));
  } finally {
    infoLog.mockRestore();
    checkAuth.mockRestore();
    findLab.mockRestore();
  }
});

async function startServer(options: Partial<ServerOptions> = {}) {
  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });
  const io = createSocketServer(httpServer, options);
  httpServers.push(httpServer);
  servers.push(io);
  httpServer.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  return {
    io,
    url: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=websocket`,
  };
}

// Use the Engine.IO/Socket.IO handshake over a real WebSocket, without a client dependency.
function connect(url: string, cookie = credentials().cookie, handshake: unknown = { labId }): Promise<{ client: WebSocket; id: string }> {
  // Bun supports headers on its WebSocket constructor; the DOM types omit this extension.
  const Client = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket;
  const client = new Client(url, { headers: { Origin: origin, Cookie: cookie } });
  clients.push(client);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.close();
      reject(new Error('Socket connection timed out'));
    }, 2000);
    client.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Socket connection failed'));
    });
    client.addEventListener('message', ({ data }) => {
      const packet = String(data);
      if (packet.startsWith('0')) client.send(`40${JSON.stringify(handshake)}`);
      else if (packet === '2') client.send('3');
      else if (packet.startsWith('40')) {
        clearTimeout(timer);
        resolve({ client, id: JSON.parse(packet.slice(2)).sid });
      }
      else if (packet.startsWith('44')) {
        clearTimeout(timer);
        client.close();
        reject(new Error(JSON.parse(packet.slice(2)).data.code));
      }
    });
  });
}

describe('Socket.IO server', () => {
  test('accepts multiple clients and removes a disconnected client independently', async () => {
    const { io, wsUrl, url } = await startServer();
    const connected = await Promise.all(Array.from({ length: 3 }, () => connect(wsUrl)));
    expect(new Set(connected.map(({ id }) => id)).size).toBe(3);
    expect(io.sockets.sockets.size).toBe(3);
    for (const { id } of connected) {
      expect(infoLog).toHaveBeenCalledWith(`Socket connected: ${id}`);
    }

    const first = connected[0]!;
    const disconnected = once(io.sockets.sockets.get(first.id)!, 'disconnect');
    first.client.close();
    const [reason] = await disconnected;
    expect(io.sockets.sockets.size).toBe(2);
    expect(io.sockets.sockets.has(first.id)).toBe(false);
    expect(infoLog).toHaveBeenCalledWith(`Socket disconnected: ${first.id} (${reason})`);

    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('creates independent instances with their own clients and listeners', async () => {
    const first = await startServer();
    const second = await startServer();
    const firstClient = await connect(first.wsUrl);
    const secondClient = await connect(second.wsUrl);

    expect(first.io).not.toBe(second.io);
    expect(first.io.listenerCount('connection')).toBe(1);
    expect(second.io.listenerCount('connection')).toBe(1);
    expect(first.io.sockets.sockets.has(firstClient.id)).toBe(true);
    expect(first.io.sockets.sockets.has(secondClient.id)).toBe(false);
    expect(second.io.sockets.sockets.has(secondClient.id)).toBe(true);
    expect(second.io.sockets.sockets.has(firstClient.id)).toBe(false);
  });

  test('applies CORS options provided by the caller to polling handshakes', async () => {
    const { url } = await startServer({ cors: { origin, credentials: true } });
    const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: origin },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(await response.text()).toMatch(/^0\{/);
  });

  test('rejects missing cookies, invalid JWTs, and forged user identity before querying labs', async () => {
    const { wsUrl } = await startServer();
    await expect(connect(wsUrl, '')).rejects.toThrow('AUTH_REQUIRED');
    await expect(connect(wsUrl, 'accessToken=bad; refreshToken=bad')).rejects.toThrow('AUTH_REQUIRED');
    expect(findLab).not.toHaveBeenCalled();
    await expect(connect(wsUrl, credentials().cookie, { labId, userId: 'another-user' })).rejects.toThrow('INVALID_LAB_ID');
    expect(findLab).not.toHaveBeenCalled();
  });

  test('requires an active database session and an owned running lab', async () => {
    const { ApiError } = await import('shared/utils/ApiError');
    const { wsUrl } = await startServer();
    checkAuth.mockRejectedValueOnce(new ApiError(401, 'Revoked'));
    await expect(connect(wsUrl)).rejects.toThrow('AUTH_REQUIRED');
    findLab.mockResolvedValueOnce(undefined);
    await expect(connect(wsUrl)).rejects.toThrow('LAB_NOT_FOUND');
    findLab.mockResolvedValueOnce({ labId, status: 'queued', expiresAt: null });
    await expect(connect(wsUrl)).rejects.toThrow('LAB_NOT_READY');
    findLab.mockResolvedValueOnce({ labId, status: 'running', expiresAt: new Date(0) });
    await expect(connect(wsUrl)).rejects.toThrow('LAB_EXPIRED');
    expect(findLab).toHaveBeenCalledWith(userId, labId);
  });

  test('rejects unexpected and missing origins even when CORS options are overridden', async () => {
    const { url } = await startServer({ cors: { origin: '*' } });
    for (const value of ['https://evil.example', undefined]) {
      const headers = new Headers();
      if (value) headers.set('Origin', value);
      const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers });
      expect(response.status).toBe(403);
    }
  });

  test('disconnects at lab expiry and removes its session listener', async () => {
    findLab.mockResolvedValue({ labId, status: 'running', expiresAt: new Date(Date.now() + 300) });
    const { io, wsUrl } = await startServer();
    const { cookie, refresh } = credentials();
    const { id } = await connect(wsUrl, cookie);
    const key = sessionEventKey(refresh);
    expect(sessionEvents.listenerCount(key)).toBe(1);
    await once(io.sockets.sockets.get(id)!, 'disconnect');
    expect(io.sockets.sockets.size).toBe(0);
    expect(sessionEvents.listenerCount(key)).toBe(0);
  });

  test('logout notification closes every socket for that session', async () => {
    const { io, wsUrl } = await startServer();
    const { cookie, refresh } = credentials();
    await Promise.all([connect(wsUrl, cookie), connect(wsUrl, cookie)]);
    sessionEvents.emit(sessionEventKey(refresh));
    expect(io.sockets.sockets.size).toBe(0);
    expect(sessionEvents.listenerCount(sessionEventKey(refresh))).toBe(0);
  });

  test('database failures return a generic connection error without leaking details', async () => {
    const { wsUrl } = await startServer();
    findLab.mockRejectedValueOnce(new Error('Private database details'));
    await expect(connect(wsUrl)).rejects.toThrow('SERVICE_UNAVAILABLE');
  });

  test('periodic validation detects a session revoked on another gateway instance', async () => {
    const { ApiError } = await import('shared/utils/ApiError');
    const { io, wsUrl } = await startServer();
    const { id } = await connect(wsUrl);
    checkAuth.mockRejectedValue(new ApiError(401, 'Session revoked'));
    await once(io.sockets.sockets.get(id)!, 'disconnect');
    expect(io.sockets.sockets.size).toBe(0);
  }, 10_000);
});
