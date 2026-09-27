import dotenv from 'dotenv';
import z from 'zod';
import logger from '../utils/logger';

dotenv.config();

const envSchema = z.object({
  DB_URL: z.url(),
});

const res = envSchema.safeParse(process.env);
if (!res.success) {
  logger.error('Invalid env vars in DB package\n' + res.error.message);
  process.exit(1);
}
logger.info('ENV vars valid in DB.');

export const env = res.data;
