import { eq } from 'drizzle-orm';
import { usersTable } from 'shared/db/schema/schema';
import type { Transaction } from '../../../types/db';

export const findUserByGithubId = async (tx: Transaction, githubId: string) => {
  const users = await tx.select().from(usersTable).where(eq(usersTable.githubId, githubId));
  return users[0];
};

export const addGithubUser = async (tx: Transaction, githubId: string, email: string) => {
  const users = await tx.insert(usersTable).values({ githubId, email }).onConflictDoNothing().returning();
  return users[0];
};
