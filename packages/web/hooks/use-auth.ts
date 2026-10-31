'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { getCurrentUser, getGithubAuthorizationUrl, logout } from '@/lib/auth';

export const currentUserKey = ['auth', 'user'] as const;

export function useCurrentUser() {
  return useQuery({
    queryKey: currentUserKey,
    queryFn: ({ signal }) => getCurrentUser(signal),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
}

export function useGithubLogin() {
  return useMutation({ mutationFn: getGithubAuthorizationUrl, retry: false });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: logout,
    retry: false,
    onSuccess: async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      router.replace('/login');
    },
  });
}
