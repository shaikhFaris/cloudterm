import { db } from 'shared/db/drizzle';
import { labQueue } from 'shared/redis/Queue';
import { insertWorkspace } from './lab-repository';
import type { Job, JobProgress } from 'bullmq';

export const createLab = async (userId: string) => {
  let job: Job<any, any, string, JobProgress> | undefined;
  try {
    return db.transaction(async (tx) => {
      job = await labQueue.add(
        'create-lab',
        { userId },
        {
          attempts: 3,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      await insertWorkspace(tx, userId);

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
