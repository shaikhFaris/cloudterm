import { Worker, Job } from 'bullmq';
import { QUEUE_NAME } from 'shared/const/redis';
import { env } from './env';
import { listPods } from './k8s';

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    if (!job || !job.data) {
      return;
    }
    const userId = job.data.userId as string;
    await listPods();
    console.log(job.data);
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
