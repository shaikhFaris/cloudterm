'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { QueryClientProvider } from '@tanstack/react-query';
import { SESSION_EXPIRED_EVENT } from '@/lib/api-client';
import { createQueryClient } from '@/lib/query-client';

export function QueryProvider({ children }: { children: ReactNode }) {
  // A fresh instance during server rendering avoids sharing user caches.
  const [queryClient] = useState(createQueryClient);
  const router = useRouter();

  useEffect(() => {
    function onSessionExpired() {
      queryClient.clear();
      router.replace('/login?error=session_expired');
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, [queryClient, router]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
