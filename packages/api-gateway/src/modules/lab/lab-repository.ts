import { workspaceTable } from 'shared/db/schema/schema';
import type { Transaction } from '../../types/db';

export const insertWorkspace = async (tx: Transaction, userId: string) => {
  return await tx.insert(workspaceTable).values({
    status: 'queued',
    userId,
  });
};
