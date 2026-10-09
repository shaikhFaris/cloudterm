import dotenv from 'dotenv';
import z from 'zod';
import logger from 'shared/utils/logger';

dotenv.config();

const envSchema = z.object({
  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number().default(6379),
});

const res = envSchema.safeParse(process.env);
if (!res.success) {
  logger.error('Invalid env vars in k8s package\n' + res.error.message);
  process.exit(1);
}
logger.info('ENV vars valid in k8s.');

export const env = res.data;
