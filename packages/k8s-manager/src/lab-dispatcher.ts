import { enqueueLab } from 'shared/redis/lab-jobs';
import { listQueuedWorkspaces } from './workspace-repository';

/** Queued database rows survive API crashes between commit and Redis enqueue. */
export async function dispatchQueuedLabs() {
  const labs = await listQueuedWorkspaces();
  console.log(labs);

  const results = await Promise.allSettled(labs.map((lab) => enqueueLab(lab.userId, lab.id)));
  for (const result of results) {
    if (result.status === 'rejected')
      console.error('Failed to dispatch queued lab:', result.reason);
  }
}

export async function startLabDispatcher(intervalMs = 10_000) {
  while (true) {
    try {
      await dispatchQueuedLabs();
    } catch (error) {
      console.error('Queued lab dispatch failed:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
