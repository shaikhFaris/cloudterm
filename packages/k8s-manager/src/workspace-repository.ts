import { and, eq, inArray } from 'drizzle-orm';
import { db } from 'shared/db/drizzle';
import { workspaceTable } from 'shared/db/schema/schema';

export async function findOwnedWorkspace(userId: string, workspaceId: string) {
  const rows = await db.select().from(workspaceTable).where(and(
    eq(workspaceTable.id, workspaceId), eq(workspaceTable.userId, userId),
  ));
  return rows[0];
}

export async function markWorkspaceRunning(userId: string, workspaceId: string): Promise<boolean> {
  const rows = await db.update(workspaceTable).set({ status: 'running' }).where(and(
    eq(workspaceTable.id, workspaceId), eq(workspaceTable.userId, userId),
    inArray(workspaceTable.status, ['queued', 'running']),
  )).returning({ id: workspaceTable.id });
  return rows.length > 0;
}

export async function markWorkspaceDeleted(workspaceId: string, userId?: string): Promise<void> {
  await db.update(workspaceTable).set({ status: 'deleted' }).where(and(
    eq(workspaceTable.id, workspaceId),
    userId === undefined ? undefined : eq(workspaceTable.userId, userId),
  ));
}

export async function listRunningWorkspaces() {
  return db.select({ id: workspaceTable.id, userId: workspaceTable.userId })
    .from(workspaceTable).where(eq(workspaceTable.status, 'running'));
}
