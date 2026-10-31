import axios from 'axios';
import { QueryClient } from '@tanstack/react-query';
import { SessionExpiredError } from './api-client-core';

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2 || error instanceof SessionExpiredError || axios.isCancel(error)) return false;
  if (!axios.isAxiosError(error)) return false;
  if (error.code === 'ERR_CANCELED') return false;
  const status = error.response?.status;
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetryQuery },
      mutations: { retry: false },
    },
  });
}
