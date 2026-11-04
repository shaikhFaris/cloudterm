import z from 'zod';
import { ApiError } from 'shared/utils/ApiError';

export const LAB_IDEMPOTENCY_TTL_SECONDS = 30;
const requestKey = (userId: string, key: string) => `labs:create:${userId}:${key}`;

export async function findLabRequest(userId: string, key: string): Promise<string | null> {
  try {
    const { labRedis: redis } = await import('./lab-redis');
    const labId = await redis.get(requestKey(userId, key));
    if (labId !== null && !z.uuid().safeParse(labId).success) throw new Error('Invalid lab request record.');
    return labId;
  } catch {
    throw new ApiError(503, 'Lab creation is temporarily unavailable. Please retry.');
  }
}

/** The caller holds the user's database row lock, including when updating a reservation. */
export async function rememberLabRequest(userId: string, key: string, labId: string): Promise<void> {
  try {
    const { labRedis: redis } = await import('./lab-redis');
    await redis.set(requestKey(userId, key), labId, 'EX', LAB_IDEMPOTENCY_TTL_SECONDS);
  } catch {
    throw new ApiError(503, 'Lab creation is temporarily unavailable. Please retry.');
  }
}
