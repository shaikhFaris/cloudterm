import dotenv from 'dotenv';
import z from 'zod';
import logger from 'shared/utils/logger';

dotenv.config();

const envSchema = z.object({
  WS_PORT: z.coerce.number().int().min(1).max(65535).default(3501),
  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number().default(6379),
  SHARED_KEY: z.string().min(32),
});

const res = envSchema.safeParse(process.env);
if (!res.success) {
  logger.error('Invalid env vars in k8s package\n' + res.error.message);
  process.exit(1);
}
logger.info('ENV vars valid in k8s.');

export const env = res.data;
