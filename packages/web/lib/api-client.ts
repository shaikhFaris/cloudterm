'use client';

import { createApiClient } from './api-client-core';

export const SESSION_EXPIRED_EVENT = 'cloudterm:session-expired';

/** Browser requests only: JWTs remain in HttpOnly cookies. */
export const api = createApiClient({
  onSessionExpired: () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
  },
});
