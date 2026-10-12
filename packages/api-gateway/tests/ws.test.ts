import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { Server, ServerOptions } from 'socket.io';
import logger from 'shared/utils/logger';
import { createSocketServer } from '../src/ws';

const servers: Server[] = [];
const clients: WebSocket[] = [];
let infoLog: Mock<typeof logger.info>;

beforeEach(() => {
  infoLog = spyOn(logger, 'info').mockImplementation(() => logger);
});

afterEach(async () => {
  const disconnections = servers.flatMap((io) =>
    Array.from(io.sockets.sockets.values()).map((socket) => once(socket, 'disconnect')),
  );
  clients.splice(0).forEach((client) => client.close());
  try {
    await Promise.all(disconnections);
    await Promise.all(servers.splice(0).map((io) => new Promise<void>((resolve) => io.close(() => resolve()))));
  } finally {
    infoLog.mockRestore();
  }
});

async function startServer(options: Partial<ServerOptions> = {}) {
  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  });
  const io = createSocketServer(httpServer, options);
  servers.push(io);
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  return {
    io,
    url: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=websocket`,
  };
}

// Use the Engine.IO/Socket.IO handshake over a real WebSocket, without a client dependency.
function connect(url: string): Promise<{ client: WebSocket; id: string }> {
  const client = new WebSocket(url);
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
      if (packet.startsWith('0')) client.send('40');
      else if (packet === '2') client.send('3');
      else if (packet.startsWith('40')) {
        clearTimeout(timer);
        resolve({ client, id: JSON.parse(packet.slice(2)).sid });
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
    const origin = 'https://app.example.com';
    const { url } = await startServer({ cors: { origin, credentials: true } });
    const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: origin },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(await response.text()).toMatch(/^0\{/);
  });
});
