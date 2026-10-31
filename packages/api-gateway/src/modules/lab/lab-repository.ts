import { and, eq } from 'drizzle-orm';
import { db } from 'shared/db/drizzle';
import { workspaceTable } from 'shared/db/schema/schema';
import type { Transaction } from '../../types/db';

export const findOwnedLabStatus = async (userId: string, labId: string) => {
  const rows = await db
    .select({ labId: workspaceTable.id, status: workspaceTable.status })
    .from(workspaceTable)
    .where(and(eq(workspaceTable.id, labId), eq(workspaceTable.userId, userId)))
    .limit(1);

  return rows[0];
};

export const insertWorkspace = async (tx: Transaction, userId: string) => {
  return (
    await tx
      .insert(workspaceTable)
      .values({
        status: 'queued',
        userId,
      })
      .returning()
  )[0];
};
