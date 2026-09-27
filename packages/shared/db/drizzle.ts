import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env } from './env';

export const db: NodePgDatabase = drizzle(env.DB_URL);
