import { db } from 'shared/db/drizzle';
import { labQueue } from 'shared/redis/Queue';
import { insertWorkspace } from './lab-repository';
import type { Job, JobProgress } from 'bullmq';
import { ApiError } from 'shared/utils/ApiError';

export const getLabStatus = async (_userId: string, _labId: string): Promise<unknown> => {
  // TODO: Retrieve the lab status, scoped to the authenticated user's labs.
  throw new ApiError(501, 'Lab status retrieval is not implemented yet.');
};

export const createLab = async (userId: string) => {
  let job: Job<any, any, string, JobProgress> | undefined;
  try {
    return db.transaction(async (tx) => {
      const res = await insertWorkspace(tx, userId);
      if (!res) throw new Error('Internal Error in k8s manager');

      job = await labQueue.add(
        'create-lab',
        { userId, workspaceId: res.id },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      return {
        jobId: job.id,
        status: 'queued' as const,
      };
    });
  } catch (error) {
    // remove job if DB failes to insert
    if (job && job?.id) await labQueue.remove(job?.id);
    throw error;
  }
};
