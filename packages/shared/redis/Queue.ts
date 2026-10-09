import { Queue } from 'bullmq';
import { env } from './env';
import { QUEUE_NAME } from '../const/redis';

export const labQueue = new Queue(QUEUE_NAME, {
  connection: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  },
});

labQueue.on('error', (err) => {
  console.error(err);
});
