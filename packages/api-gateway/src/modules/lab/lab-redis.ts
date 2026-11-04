import Redis from 'ioredis';
import { env } from 'shared/redis/env';

export const labRedis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  connectTimeout: 5_000,
  commandTimeout: 5_000,
  maxRetriesPerRequest: 1,
});

labRedis.on('error', (error) => console.error('Lab idempotency Redis error:', error.message));
