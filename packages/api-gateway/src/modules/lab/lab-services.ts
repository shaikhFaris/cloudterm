import { db } from 'shared/db/drizzle';
import { findOwnedLabStatus, insertWorkspace } from './lab-repository';
import type { Job, JobProgress } from 'bullmq';
import { ApiError } from 'shared/utils/ApiError';

export const getLabStatus = async (userId: string, labId: string) => {
  const lab = await findOwnedLabStatus(userId, labId);
  if (!lab) throw new ApiError(404, 'Lab not found.');
  return lab;
};

export const createLab = async (userId: string) => {
  // Status reads need only PostgreSQL; connect to the queue when creating a lab.
  const { labQueue } = await import('shared/redis/Queue');
  let job: Job<any, any, string, JobProgress> | undefined;
  try {
    return await db.transaction(async (tx) => {
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
        labId: res.id,
        jobId: job.id,
        status: 'queued' as const,
      };
    });
  } catch (error) {
    // Await the transaction so commit failures also attempt queue cleanup.
    if (job?.id) {
      try {
        await labQueue.remove(job.id);
      } catch (cleanupError) {
        console.error('Failed to remove lab job after transaction failure.', cleanupError);
      }
    }
    throw error;
  }
};
