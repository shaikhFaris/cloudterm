import { pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const workspaceStatusEnum = pgEnum('workspace_status', ['loading', 'running', 'deleted']);

export const usersTable = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar({ length: 255 }).notNull().unique(),
  password: varchar({ length: 255 }).notNull(),
  createdAt: timestamp('created_at', {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
});

export const refreshTokenTable = pgTable('refresh_token', {
  token: text('refresh_token'),
  userId: uuid('user_id')
    .references(() => usersTable.id, { onDelete: 'cascade' })
    .unique(),
});

export const workspaceTable = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: workspaceStatusEnum('status').notNull(),
  createdAt: timestamp('created_at', {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
  userId: uuid('user_id')
    .references(() => usersTable.id, { onDelete: 'cascade' })
    .notNull(),
});
