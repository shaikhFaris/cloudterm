import dotenv from 'dotenv';
import z from 'zod';
import logger from 'shared/utils/logger';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.literal(['dev', 'prod']),
  PORT: z.coerce.number(),
  JWT_ACCESS_TOKEN_SECRET: z.string(),
  JWT_ACCESS_TOKEN_TIME_IN_MS: z.coerce.number(),
  JWT_REFRESH_TOKEN_SECRET: z.string(),
  JWT_REFRESH_TOKEN_TIME_IN_MS: z.coerce.number(),
  COOKIE_DOMAIN: z.string(),
  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number().default(6379),
});

const res = envSchema.safeParse(process.env);
if (!res.success) {
  logger.error('ENV var invalid in API-GATEWAY\n' + res.error.message);
  process.exit(1);
}
logger.info('ENV vars valid in API-GATEWAY.');

export const env = res.data;
