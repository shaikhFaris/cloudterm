import { and, eq, inArray } from 'drizzle-orm';
import { db } from 'shared/db/drizzle';
import { usersTable, workspaceTable } from 'shared/db/schema/schema';
import type { Transaction } from '../../types/db';

export const findOwnedLabStatus = async (
  userId: string,
  labId: string,
  executor: typeof db | Transaction = db,
) => {
  const rows = await executor
    .select({
      labId: workspaceTable.id,
      status: workspaceTable.status,
      expiresAt: workspaceTable.expiresAt,
    })
    .from(workspaceTable)
    .where(and(eq(workspaceTable.id, labId), eq(workspaceTable.userId, userId)))
    .limit(1);

  return rows[0];
};

export const lockLabOwner = async (tx: Transaction, userId: string) => {
  const rows = await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .for('update');
  return rows[0];
};

export const findActiveLab = async (userId: string, executor: typeof db | Transaction = db) => {
  const rows = await executor
    .select({ labId: workspaceTable.id, status: workspaceTable.status })
    .from(workspaceTable)
    .where(
      and(eq(workspaceTable.userId, userId), inArray(workspaceTable.status, ['queued', 'running'])),
    )
    .limit(1);
  return rows[0] ?? null;
};

export const insertWorkspace = async (tx: Transaction, userId: string, labId: string) => {
  return (
    await tx
      .insert(workspaceTable)
      .values({
        id: labId,
        status: 'queued',
        userId,
      })
      .returning()
  )[0];
};
