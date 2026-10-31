import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Public auth endpoints should not trigger session renewal. */
    skipAuthRefresh?: boolean;
    _authRetried?: boolean;
    _authGeneration?: number;
  }
}

export class SessionExpiredError extends Error {
  readonly status = 401;

  constructor() {
    super('Your session has expired. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

function canRefresh(config: InternalAxiosRequestConfig): boolean {
  if (config.skipAuthRefresh) return false;
  const url = new URL(axios.getUri(config), 'https://cloudterm.invalid');
  const path = url.pathname;
  return url.origin === 'https://cloudterm.invalid' && path.startsWith('/api/v1/') &&
    !/^\/api\/v1\/auth\/(github(?:\/|$)|refresh\/?$|login\/?$|signup\/?$)/.test(path);
}

/** Create one client per browser app. Never share this state between server users. */
export function createApiClient(options: {
  adapter?: AxiosAdapter;
  onSessionExpired?: () => void;
} = {}) {
  const defaults = {
    baseURL: '/api/v1',
    withCredentials: true,
    timeout: 10_000,
    headers: { Accept: 'application/json' },
    ...(options.adapter ? { adapter: options.adapter } : {}),
  };
  const api = axios.create(defaults);
  // This instance has no refresh interceptor, so renewal cannot recurse.
  const refreshApi = axios.create(defaults);
  let refreshPromise: Promise<void> | undefined;
  let generation = 0;
  let sessionExpired: SessionExpiredError | undefined;

  function expireSession() {
    if (!sessionExpired) {
      sessionExpired = new SessionExpiredError();
      options.onSessionExpired?.();
    }
    return sessionExpired;
  }

  function refreshSession() {
    if (!refreshPromise) {
      refreshPromise = refreshApi.post('/auth/refresh')
        .then(() => { generation += 1; })
        .catch((error: unknown) => {
          if (axios.isAxiosError(error) && error.response?.status === 401) {
            throw expireSession();
          }
          // Network/server failures do not prove that the session ended.
          throw error;
        })
        .finally(() => { refreshPromise = undefined; });
    }
    return refreshPromise;
  }

  api.interceptors.request.use(async (config) => {
    if (canRefresh(config)) {
      if (sessionExpired) throw sessionExpired;
      // Requests started during renewal wait for the updated browser cookie.
      if (refreshPromise) await refreshPromise;
      if (config.signal?.aborted) throw new axios.CanceledError();
      config._authGeneration = generation;
    }
    return config;
  });

  api.interceptors.response.use((response) => response, async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401 ||
      !error.config || !canRefresh(error.config)) throw error;

    const config = error.config;
    if (config.signal?.aborted) throw new axios.CanceledError();
    if (sessionExpired) throw sessionExpired;
    if (config._authRetried) throw expireSession();
    config._authRetried = true;

    // A late 401 from an older request can use an already-renewed cookie.
    if (config._authGeneration === generation) await refreshSession();
    if (config.signal?.aborted) throw new axios.CanceledError();
    return api.request(config);
  });

  return api;
}
