import './config/validateEnvs';
import { env } from './config/validateEnvs';
import { createServer } from 'node:http';
import app from './app';
import { createSocketServer } from './ws';
import logger from 'shared/utils/logger';

const httpServer = createServer(app);
createSocketServer(httpServer, {
  cors: {
    origin: '*',
  },
});

httpServer.listen(env.PORT, () => {
  logger.info('Server started on port ' + env.PORT);
});
