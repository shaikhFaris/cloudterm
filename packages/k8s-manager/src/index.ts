import { Worker } from 'bullmq';
import { QUEUE_NAME } from 'shared/const/redis';
import { env } from './env';
import { startCleanupWorker } from './k8s';
import { processLabJob } from './lab-processor';
// import { listPods } from './k8s';

const worker = new Worker(
  QUEUE_NAME,
  processLabJob,
  {
    connection: {
      host: env.REDIS_HOST,
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
