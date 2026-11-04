import { randomUUID } from 'node:crypto';
import { db } from 'shared/db/drizzle';
import { enqueueLab } from 'shared/redis/lab-jobs';
import { findActiveLab, findOwnedLabStatus, insertWorkspace, lockLabOwner } from './lab-repository';
import { findLabRequest, rememberLabRequest } from './lab-idempotency';
import { ApiError } from 'shared/utils/ApiError';

export const getLabStatus = async (userId: string, labId: string) => {
  const lab = await findOwnedLabStatus(userId, labId);
  if (!lab) throw new ApiError(404, 'Lab not found.');
  return lab;
};

export const getActiveLab = (userId: string) => findActiveLab(userId);

export const createLab = async (userId: string, idempotencyKey: string) => {
  const lab = await db.transaction(async (tx) => {
    // Serialize creates across tabs and gateway instances, even after Redis expiry.
    if (!await lockLabOwner(tx, userId)) throw new ApiError(401, 'User not authenticated.');
    const previousId = await findLabRequest(userId, idempotencyKey);
    if (previousId) {
      const previousLab = await findOwnedLabStatus(userId, previousId, tx);
      if (previousLab) return previousLab;
    }

    const active = await findActiveLab(userId, tx);
    if (active) {
      await rememberLabRequest(userId, idempotencyKey, active.labId);
      return active;
    }

    // Reuse a reservation left by an aborted transaction rather than changing IDs.
    const workspace = await insertWorkspace(tx, userId, previousId ?? randomUUID());
    if (!workspace) throw new ApiError(500, 'Unable to create lab.');
    await rememberLabRequest(userId, idempotencyKey, workspace.id);
    return { labId: workspace.id, status: workspace.status };
  });

  // Commit first so a fast worker can see the row. The manager also dispatches
  // queued rows to recover a crash or Redis outage at this boundary.
  if (lab.status === 'queued') {
    try {
      await enqueueLab(userId, lab.labId);
    } catch {
      throw new ApiError(503, 'Your lab is queued. Please retry to check its progress.');
    }
  }
  return { ...lab, jobId: lab.labId };
};
