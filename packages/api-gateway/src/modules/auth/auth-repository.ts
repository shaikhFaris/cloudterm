import { eq } from 'drizzle-orm';
import { refreshTokenTable, usersTable } from 'shared/db/schema/schema';
import { db } from 'shared/db/drizzle';
import type { Transaction } from '../../types/db';

export const addNewUser = async (tx: Transaction, email: string, hashedPass: string) => {
  await tx.insert(usersTable).values({
    email: email,
    password: hashedPass,
  });
};

export const findUserByEmail = async (tx: Transaction, email: string) => {
  const user = await tx.select().from(usersTable).where(eq(usersTable.email, email));
  return user[0];
};
export const findUserByRefreshToken = async (
  tx: Transaction,
  refreshToken: string,
  userId: string,
) => {
  const user = await tx
    .select()
    .from(usersTable)
    .innerJoin(refreshTokenTable, eq(refreshTokenTable.token, refreshToken))
    .where(eq(usersTable.id, userId));
  return user[0]?.users;
};

export const insertOrUpdateRefreshToken = async (
  tx: Transaction,
  refreshToken: string,
  userId: string,
) => {
  await tx
    .insert(refreshTokenTable)
    .values({ userId, token: refreshToken })
    .onConflictDoUpdate({
      target: refreshTokenTable.userId,
      set: { token: refreshToken },
    });
};

export const deleteRefreshToken = async (refreshToken: string) => {
  await db.delete(refreshTokenTable).where(eq(refreshTokenTable.token, refreshToken));
};
