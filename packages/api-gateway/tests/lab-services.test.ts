import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Transaction } from '../src/types/db';

process.env.DB_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
const userId = '83bcfe2d-bcaa-41e5-8b3a-4875ee43019a';
const labId = '4d3f5c21-cfde-4e53-a7d5-bf43a513d153';
const workspace = { id: labId, userId, status: 'queued' as const, createdAt: new Date() };
const add = mock(async (..._args: unknown[]) => ({ id: 'job-id' }));
const remove = mock(async (_jobId: string) => 1);
mock.module('shared/redis/Queue', () => ({ labQueue: { add, remove } }));

const repository = await import('../src/modules/lab/lab-repository');
const { db } = await import('shared/db/drizzle');
const { createLab, getLabStatus } = await import('../src/modules/lab/lab-services');

beforeEach(() => {
  add.mockReset().mockResolvedValue({ id: 'job-id' });
  remove.mockReset().mockResolvedValue(1);
});
afterEach(() => mock.restore());

describe('lab status service', () => {
  test('returns each persisted lifecycle status without consulting the queue', async () => {
    const lookup = spyOn(repository, 'findOwnedLabStatus');
    for (const status of ['queued', 'running', 'deleted'] as const) {
      lookup.mockResolvedValue({ labId, status });
      expect(await getLabStatus(userId, labId)).toEqual({ labId, status });
      expect(lookup).toHaveBeenLastCalledWith(userId, labId);
    }
    expect(add).not.toHaveBeenCalled();
  });

  test('returns the same 404 for nonexistent and other users\' labs', async () => {
    spyOn(repository, 'findOwnedLabStatus').mockResolvedValue(undefined);
    for (const owner of [userId, 'c74ed688-a64e-412f-915a-eb4b04659cec']) {
      await expect(getLabStatus(owner, labId)).rejects.toMatchObject({ status: 404, message: 'Lab not found.' });
    }
  });

  test('propagates database outages instead of claiming a lab is missing', async () => {
    const failure = new Error('Database unavailable');
    spyOn(repository, 'findOwnedLabStatus').mockRejectedValue(failure);
    await expect(getLabStatus(userId, labId)).rejects.toBe(failure);
  });

  test('the SQL lookup includes both lab ID and authenticated owner and selects only public fields', async () => {
    const limit = mock(async (_count: number) => [{ labId, status: 'queued' as const }]);
    const where = mock((_condition: unknown) => ({ limit }));
    const from = mock((_table: unknown) => ({ where }));
    const select = spyOn(db, 'select').mockReturnValue({ from } as unknown as ReturnType<typeof db.select>);
    expect(await repository.findOwnedLabStatus(userId, labId)).toEqual({ labId, status: 'queued' });
    const sql = new PgDialect().sqlToQuery(where.mock.calls[0]![0] as SQL);
    expect(sql.params).toEqual([labId, userId]);
    expect(sql.sql).toContain('"workspaces"."id"');
    expect(sql.sql).toContain('"workspaces"."user_id"');
    expect(Object.keys(select.mock.calls[0]![0]!)).toEqual(['labId', 'status']);
    expect(limit).toHaveBeenCalledWith(1);
  });
});

describe('lab creation service', () => {
  beforeEach(() => {
    spyOn(db, 'transaction').mockImplementation(async (callback) => callback({} as Transaction));
    spyOn(repository, 'insertWorkspace').mockResolvedValue(workspace);
  });

  test('returns a pollable lab ID and queues the same workspace with bounded retries', async () => {
    expect(await createLab(userId)).toEqual({ labId, jobId: 'job-id', status: 'queued' });
    expect(add).toHaveBeenCalledWith('create-lab', { userId, workspaceId: labId }, {
      attempts: 3, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: true, removeOnFail: false,
    });
    expect(remove).not.toHaveBeenCalled();
  });

  test('does not enqueue if the workspace insert fails', async () => {
    const failure = new Error('Insert failed');
    spyOn(repository, 'insertWorkspace').mockRejectedValue(failure);
    await expect(createLab(userId)).rejects.toBe(failure);
    expect(add).not.toHaveBeenCalled();
  });

  test('propagates enqueue failures so the transaction rolls back', async () => {
    const failure = new Error('Queue unavailable');
    add.mockRejectedValue(failure);
    await expect(createLab(userId)).rejects.toBe(failure);
    expect(remove).not.toHaveBeenCalled();
  });

  test('attempts queue cleanup when committing the database transaction fails', async () => {
    const failure = new Error('Commit failed');
    spyOn(db, 'transaction').mockImplementation(async (callback) => {
      await callback({} as Transaction);
      throw failure;
    });
    await expect(createLab(userId)).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledWith('job-id');
  });

  test('preserves the original transaction error if queue cleanup also fails', async () => {
    const failure = new Error('Commit failed');
    spyOn(db, 'transaction').mockImplementation(async (callback) => {
      await callback({} as Transaction);
      throw failure;
    });
    remove.mockRejectedValue(new Error('Cleanup failed'));
    const log = spyOn(console, 'error').mockImplementation(() => {});
    await expect(createLab(userId)).rejects.toBe(failure);
    expect(log).toHaveBeenCalledWith('Failed to remove lab job after transaction failure.', expect.any(Error));
  });
});
