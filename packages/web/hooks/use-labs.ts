'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createLab, getActiveLab, getLabStatus, labPollInterval, type Lab } from '@/lib/labs';

export function useLabs(userId: string) {
  const client = useQueryClient();
  const requestKey = useRef<string | null>(null);
  const submitting = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const activeKey = ['labs', userId, 'active'] as const;
  const statusKey = (id: string) => ['labs', userId, id] as const;
  const active = useQuery({
    queryKey: activeKey,
    queryFn: ({ signal }) => getActiveLab(signal),
    staleTime: 0,
    refetchOnMount: 'always',
    // Discover labs started in another tab while this page is idle.
    refetchInterval: 5_000,
  });
  const labId = active.data?.labId ?? selected;
  const status = useQuery({
    queryKey: statusKey(labId ?? 'none'),
    queryFn: ({ signal }) => getLabStatus(labId!, signal),
    enabled: !!labId,
    staleTime: 0,
    refetchInterval: (query) => labPollInterval(query.state.data),
  });
  const mutation = useMutation({
    mutationFn: createLab,
    retry: false,
    onSuccess: (lab: Lab) => {
      setSelected(lab.labId);
      client.setQueryData(statusKey(lab.labId), lab);
      client.setQueryData(activeKey, lab.status === 'deleted' ? null : lab);
      requestKey.current = null;
    },
    onSettled: () => { submitting.current = false; void client.invalidateQueries({ queryKey: activeKey }); },
  });

  const lab = status.data ?? (active.data?.labId === labId ? active.data : undefined);
  const hasActiveLab = lab?.status === 'queued' || lab?.status === 'running';
  const canCreate = active.isSuccess && !active.isFetching && !active.data &&
    !hasActiveLab && !mutation.isPending && !status.isFetching;

  function start() {
    if (submitting.current || (!canCreate && !mutation.isError)) return;
    submitting.current = true;
    // Keep the same key after network failures and the Axios authentication retry.
    requestKey.current ??= crypto.randomUUID();
    mutation.mutate(requestKey.current);
  }

  async function checkAgain() {
    await active.refetch();
    if (labId) await status.refetch();
  }

  return { lab, active, status, mutation, canCreate, start, checkAgain };
}
