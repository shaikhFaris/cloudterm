import { describe, expect, mock, test } from 'bun:test';
import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from '../packages/web/node_modules/axios/index';
import { createApiClient, SessionExpiredError } from '../packages/web/lib/api-client-core';
import { createQueryClient, shouldRetryQuery } from '../packages/web/lib/query-client';

function reply(config: InternalAxiosRequestConfig, status: number, data: unknown = {}) {
  const response = { config, status, data, statusText: String(status), headers: new AxiosHeaders() };
  if (status >= 400) throw new AxiosError('Request failed', AxiosError.ERR_BAD_RESPONSE, config, undefined, response);
  return response;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('authenticated Axios client', () => {
  test('uses cookies and retries a POST once after renewal, preserving its body', async () => {
    const requests: InternalAxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
      requests.push(config);
      if (config.url === '/auth/refresh') return reply(config, 200);
      return reply(config, config._authRetried ? 202 : 401, { jobId: 'job' });
    };
    const api = createApiClient({ adapter });
    expect((await api.post('/labs/create', { example: 'body' }, { headers: { 'X-Example': 'value' } })).data).toEqual({ jobId: 'job' });
    expect(requests.map((request) => request.url)).toEqual(['/labs/create', '/auth/refresh', '/labs/create']);
    expect(requests[2]?.data).toBe(requests[0]?.data);
    expect(requests[2]?.headers.get('X-Example')).toBe('value');
    expect(requests.every((request) => request.withCredentials)).toBe(true);
    expect(requests[0]?.headers.has('Authorization')).toBe(false);
  });

  test('concurrent 401s share one refresh and new requests wait for it', async () => {
    const started = deferred();
    const release = deferred();
    let refreshed = false;
    let refreshes = 0;
    const paths: string[] = [];
    const api = createApiClient({ adapter: async (config) => {
      paths.push(config.url!);
      if (config.url === '/auth/refresh') {
        refreshes += 1;
        started.resolve();
        await release.promise;
        refreshed = true;
        return reply(config, 200);
      }
      return reply(config, refreshed ? 200 : 401);
    } });
    const original = Promise.all([api.get('/first'), api.get('/second'), api.get('/third')]);
    await started.promise;
    const duringRefresh = api.get('/fourth');
    release.resolve();
    await Promise.all([original, duringRefresh]);
    expect(refreshes).toBe(1);
    expect(paths.filter((path) => path === '/fourth')).toHaveLength(1);
  });

  test('a late 401 uses the renewed cookie without a second refresh', async () => {
    const slowStarted = deferred();
    const releaseSlow = deferred();
    let refreshes = 0;
    const api = createApiClient({ adapter: async (config) => {
      if (config.url === '/auth/refresh') { refreshes += 1; return reply(config, 200); }
      if (config.url === '/slow' && !config._authRetried) {
        slowStarted.resolve();
        await releaseSlow.promise;
      }
      return reply(config, config._authRetried ? 200 : 401);
    } });
    const slow = api.get('/slow');
    await slowStarted.promise;
    await api.get('/fast');
    releaseSlow.resolve();
    await slow;
    expect(refreshes).toBe(1);
  });

  test('a rejected refresh expires the session once and prevents a request storm', async () => {
    const onSessionExpired = mock();
    const started = deferred();
    const release = deferred();
    let refreshes = 0;
    let calls = 0;
    const api = createApiClient({ onSessionExpired, adapter: async (config) => {
      calls += 1;
      if (config.url === '/auth/refresh') {
        refreshes += 1;
        started.resolve();
        await release.promise;
      }
      return reply(config, 401);
    } });
    const requests = Promise.allSettled([api.get('/first'), api.get('/second')]);
    await started.promise;
    release.resolve();
    const outcomes = await requests;
    expect(outcomes.every((outcome) => outcome.status === 'rejected' && outcome.reason instanceof SessionExpiredError)).toBe(true);
    expect(refreshes).toBe(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    const previousCalls = calls;
    await expect(api.get('/third')).rejects.toBeInstanceOf(SessionExpiredError);
    expect(calls).toBe(previousCalls);
  });

  test('a repeated protected 401 cannot create a refresh loop', async () => {
    let refreshes = 0;
    let attempts = 0;
    const api = createApiClient({ adapter: async (config) => {
      if (config.url === '/auth/refresh') { refreshes += 1; return reply(config, 200); }
      attempts += 1;
      return reply(config, 401);
    } });
    await expect(api.get('/protected')).rejects.toBeInstanceOf(SessionExpiredError);
    expect(refreshes).toBe(1);
    expect(attempts).toBe(2);
  });

  test('public auth requests and explicit opt-outs never trigger refresh', async () => {
    const paths: string[] = [];
    const api = createApiClient({ adapter: async (config) => {
      paths.push(config.url!);
      return reply(config, 401);
    } });
    for (const path of ['/auth/github', '/auth/github/callback', '/auth/login', '/auth/signup', '/auth/refresh',
      'https://external.example/api/v1/private']) {
      await expect(api.get(path)).rejects.toBeInstanceOf(AxiosError);
    }
    await expect(api.get('/public', { skipAuthRefresh: true })).rejects.toBeInstanceOf(AxiosError);
    expect(paths).toHaveLength(7);
  });

  test('403 and server errors do not refresh or expire the session', async () => {
    const onSessionExpired = mock();
    let status = 403;
    let calls = 0;
    const api = createApiClient({ onSessionExpired, adapter: async (config) => {
      calls += 1;
      return reply(config, status);
    } });
    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 403 } });
    status = 503;
    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 503 } });
    expect(calls).toBe(2);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  test('a transient refresh failure does not log out the user and a later attempt can succeed', async () => {
    const onSessionExpired = mock();
    let refreshes = 0;
    const api = createApiClient({ onSessionExpired, adapter: async (config) => {
      if (config.url === '/auth/refresh') {
        refreshes += 1;
        return reply(config, refreshes === 1 ? 503 : 200);
      }
      return reply(config, config._authRetried ? 200 : 401);
    } });
    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 503 } });
    expect((await api.get('/protected')).status).toBe(200);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  test('cancelling one waiter does not cancel shared renewal or retry its request', async () => {
    const started = deferred();
    const release = deferred();
    const controller = new AbortController();
    let abortedRetries = 0;
    const api = createApiClient({ adapter: async (config) => {
      if (config.url === '/auth/refresh') { started.resolve(); await release.promise; return reply(config, 200); }
      if (config.url === '/cancelled' && config._authRetried) abortedRetries += 1;
      return reply(config, config._authRetried ? 200 : 401);
    } });
    const cancelled = api.get('/cancelled', { signal: controller.signal }).catch((error: unknown) => error);
    const other = api.get('/other');
    await started.promise;
    controller.abort();
    release.resolve();
    expect(await cancelled).toMatchObject({ code: 'ERR_CANCELED' });
    expect((await other).status).toBe(200);
    expect(abortedRetries).toBe(0);
  });

  test('separate clients never share session expiration state', async () => {
    const expired = createApiClient({ adapter: async (config) => reply(config, 401) });
    const active = createApiClient({ adapter: async (config) => reply(config, 200) });
    await expect(expired.get('/protected')).rejects.toBeInstanceOf(SessionExpiredError);
    expect((await active.get('/protected')).status).toBe(200);
  });
});

test('TanStack Query does not retry terminal auth errors or cancellations', () => {
  expect(shouldRetryQuery(0, new SessionExpiredError())).toBe(false);
  expect(shouldRetryQuery(0, new AxiosError('cancelled', 'ERR_CANCELED'))).toBe(false);
  expect(shouldRetryQuery(0, new Error('programming error'))).toBe(false);
  const network = new AxiosError('network', AxiosError.ERR_NETWORK);
  expect(shouldRetryQuery(0, network)).toBe(true);
  expect(shouldRetryQuery(2, network)).toBe(false);
  const first = createQueryClient();
  const second = createQueryClient();
  first.setQueryData(['user'], { id: 'one-user' });
  expect(second.getQueryData(['user'])).toBeUndefined();
  expect(first.getDefaultOptions().mutations?.retry).toBe(false);
  first.clear();
  second.clear();
});
