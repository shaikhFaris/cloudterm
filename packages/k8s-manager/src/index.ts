import { Worker, Job } from 'bullmq';
import { QUEUE_NAME } from 'shared/const/redis';
import { env } from './env';
import { createPod, startCleanupWorker } from './k8s';
// import { listPods } from './k8s';

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    if (!job || !job.data) {
      return;
    }
    console.log(job.data);
    const userId = job.data.userId as string;
    const workspaceId = job.data.workspaceId as string;
    if (!userId || !workspaceId) {
      console.error('UserID or workspaceId not found');
      return;
    }
    await createPod(userId, workspaceId);
  },
  {
    connection: {
      url: env.REDIS_HOST,
      port: env.REDIS_PORT,
    },
  },
);

worker.on('failed', (job, error) => {
  if (error.message.includes('stalled')) {
    console.error(`Job ${job?.id} failed due to repeated stalls`);
    // Move to manual review queue
  }
});

worker.on('error', (err) => {
  console.error(err);
});

void startCleanupWorker(10_000);
