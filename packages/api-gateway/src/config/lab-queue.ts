import { Queue } from 'bullmq';
import { env } from './validateEnvs';

export const labQueue = new Queue('lab-creation', {
  connection: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  },
});
