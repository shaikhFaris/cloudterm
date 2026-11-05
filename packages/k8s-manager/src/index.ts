import { Worker } from 'bullmq';
import { QUEUE_NAME } from 'shared/const/redis';
import { env } from './env';
import { startCleanupWorker } from './k8s';
import { processLabJob } from './lab-processor';
import { startLabDispatcher } from './lab-dispatcher';
import { createServer } from 'node:http';
import { createSocketServer } from './ws';
import logger from 'shared/utils/logger';
// import { listPods } from './k8s';

const httpServer = createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});

createSocketServer(httpServer);

httpServer.listen(env.WS_PORT, () => {
  logger.info('Kubernetes manager socket server started on port ' + env.WS_PORT);
});

const worker = new Worker(QUEUE_NAME, processLabJob, {
  connection: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  },
});

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
void startLabDispatcher();
