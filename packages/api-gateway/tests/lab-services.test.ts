import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Transaction } from '../src/types/db';

process.env.DB_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
const userId = '83bcfe2d-bcaa-41e5-8b3a-4875ee43019a';
const labId = '4d3f5c21-cfde-4e53-a7d5-bf43a513d153';
const workspace = { id: labId, userId, status: 'queued' as const, createdAt: new Date() };
const add = mock(async (..._args: unknown[]) => ({ id: 'job-id' }));
const records = new Map<string, string>();
const get = mock(async (key: string) => records.get(key) ?? null);
const set = mock(async (key: string, value: string, ..._args: unknown[]) => { records.set(key, value); return 'OK'; });
mock.module('shared/redis/Queue', () => ({ labQueue: { add } }));
mock.module('../src/modules/lab/lab-redis', () => ({ labRedis: { get, set } }));
const idempotencyKey = '7e8f67f2-704b-427d-a3f6-95c2ccc47689';

const repository = await import('../src/modules/lab/lab-repository');
const { db } = await import('shared/db/drizzle');
const { createLab, getLabStatus } = await import('../src/modules/lab/lab-services');
const { findLabRequest, rememberLabRequest, LAB_IDEMPOTENCY_TTL_SECONDS } = await import('../src/modules/lab/lab-idempotency');

beforeEach(() => {
  add.mockReset().mockResolvedValue({ id: 'job-id' });
  records.clear();
  get.mockReset().mockImplementation(async (key) => records.get(key) ?? null);
  set.mockReset().mockImplementation(async (key, value) => { records.set(key, value); return 'OK'; });
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
    spyOn(repository, 'lockLabOwner').mockResolvedValue({ id: userId });
    spyOn(repository, 'findActiveLab').mockResolvedValue(null);
    spyOn(repository, 'findOwnedLabStatus').mockResolvedValue(undefined);
    spyOn(repository, 'insertWorkspace').mockResolvedValue(workspace);
  });

  test('returns a pollable lab ID and queues the same workspace with bounded retries', async () => {
    expect(await createLab(userId, idempotencyKey)).toEqual({ labId, jobId: labId, status: 'queued' });
    expect(add).toHaveBeenCalledWith('create-lab', { userId, workspaceId: labId }, {
      jobId: labId, attempts: 3, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: true, removeOnFail: false,
    });
    expect(set).toHaveBeenCalledWith(`labs:create:${userId}:${idempotencyKey}`, labId, 'EX', 30);
  });

  test('does not enqueue if the workspace insert fails', async () => {
    const failure = new Error('Insert failed');
    spyOn(repository, 'insertWorkspace').mockRejectedValue(failure);
    await expect(createLab(userId, idempotencyKey)).rejects.toBe(failure);
    expect(add).not.toHaveBeenCalled();
  });

  test('enqueues only after the transaction has committed', async () => {
    let committed = false;
    spyOn(db, 'transaction').mockImplementation(async (callback) => {
      const result = await callback({} as Transaction);
      committed = true;
      return result;
    });
    add.mockImplementation(async () => { expect(committed).toBe(true); return { id: labId }; });
    await createLab(userId, idempotencyKey);
  });

  test('does not enqueue if committing the database transaction fails', async () => {
    const failure = new Error('Commit failed');
    spyOn(db, 'transaction').mockImplementation(async (callback) => {
      await callback({} as Transaction);
      throw failure;
    });
    await expect(createLab(userId, idempotencyKey)).rejects.toBe(failure);
    expect(add).not.toHaveBeenCalled();
    expect(await findLabRequest(userId, idempotencyKey)).toBe(labId);
  });

  test('retains queued intent on an enqueue outage and safely retries the same lab', async () => {
    add.mockRejectedValueOnce(new Error('Queue unavailable'));
    await expect(createLab(userId, idempotencyKey)).rejects.toMatchObject({ status: 503 });
    spyOn(repository, 'findOwnedLabStatus').mockResolvedValue({ labId, status: 'queued' });
    expect(await createLab(userId, idempotencyKey)).toMatchObject({ labId, status: 'queued' });
    expect(repository.insertWorkspace).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(2);
  });

  test('replaying an ended lab never starts another pod', async () => {
    await rememberLabRequest(userId, idempotencyKey, labId);
    spyOn(repository, 'findOwnedLabStatus').mockResolvedValue({ labId, status: 'deleted' });
    expect(await createLab(userId, idempotencyKey)).toMatchObject({ labId, status: 'deleted' });
    expect(repository.insertWorkspace).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  test('a new or expired key reuses a running lab instead of creating another', async () => {
    spyOn(repository, 'findActiveLab').mockResolvedValue({ labId, status: 'running' });
    expect(await createLab(userId, idempotencyKey)).toMatchObject({ labId, status: 'running' });
    records.clear(); // Simulate Redis expiry/eviction without ending the workspace.
    expect(await createLab(userId, idempotencyKey)).toMatchObject({ labId, status: 'running' });
    expect(repository.insertWorkspace).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  test('reuses a reservation left behind by a rolled-back transaction', async () => {
    await rememberLabRequest(userId, idempotencyKey, labId);
    await createLab(userId, idempotencyKey);
    expect(repository.insertWorkspace).toHaveBeenCalledWith(expect.anything(), userId, labId);
  });

  test('an expired key creates a fresh lab once the previous lab has ended', async () => {
    await rememberLabRequest(userId, idempotencyKey, labId);
    records.clear(); // The 30-second Redis TTL has elapsed; there is no active lab.
    spyOn(repository, 'insertWorkspace').mockImplementation(async (_tx, _owner, id) => ({ ...workspace, id }));
    const freshLab = await createLab(userId, idempotencyKey);
    expect(freshLab.status).toBe('queued');
    expect(freshLab.labId).not.toBe(labId);
    expect(await findLabRequest(userId, idempotencyKey)).toBe(freshLab.labId);
  });

  test('fails closed when Redis cannot preserve idempotency', async () => {
    get.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(createLab(userId, idempotencyKey)).rejects.toMatchObject({ status: 503 });
    expect(repository.insertWorkspace).not.toHaveBeenCalled();
    set.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(createLab(userId, idempotencyKey)).rejects.toMatchObject({ status: 503 });
    expect(add).not.toHaveBeenCalled();
  });

  test('rejects a deleted user before touching Redis or creating a workspace', async () => {
    spyOn(repository, 'lockLabOwner').mockResolvedValue(undefined);
    await expect(createLab(userId, idempotencyKey)).rejects.toMatchObject({ status: 401 });
    expect(get).not.toHaveBeenCalled();
    expect(repository.insertWorkspace).not.toHaveBeenCalled();
  });

  test('concurrent requests with different keys create just one workspace under the owner lock', async () => {
    let pending = Promise.resolve();
    let active: { labId: string; status: 'queued' } | null = null;
    spyOn(db, 'transaction').mockImplementation((callback) => {
      const result = pending.then(() => callback({} as Transaction));
      pending = result.then(() => {}, () => {});
      return result;
    });
    spyOn(repository, 'findActiveLab').mockImplementation(async () => active);
    spyOn(repository, 'findOwnedLabStatus').mockImplementation(async () => active ?? undefined);
    spyOn(repository, 'insertWorkspace').mockImplementation(async () => {
      active = { labId, status: 'queued' };
      return workspace;
    });
    const results = await Promise.all([
      createLab(userId, idempotencyKey), createLab(userId, '234c6264-e366-4942-a2eb-4325ee3efcb1'),
      createLab(userId, idempotencyKey),
    ]);
    expect(results.every((result) => result.labId === labId)).toBe(true);
    expect(repository.insertWorkspace).toHaveBeenCalledTimes(1);
    expect(repository.lockLabOwner).toHaveBeenCalledTimes(3);
  });
});

describe('lab idempotency records', () => {
  test('scopes keys to the authenticated user and expires them after 30 seconds', async () => {
    await rememberLabRequest(userId, idempotencyKey, labId);
    expect(LAB_IDEMPOTENCY_TTL_SECONDS).toBe(30);
    expect(await findLabRequest(userId, idempotencyKey)).toBe(labId);
    expect(await findLabRequest('another-user', idempotencyKey)).toBeNull();
  });

  test('rejects malformed Redis records', async () => {
    get.mockResolvedValueOnce('not-a-lab-id');
    await expect(findLabRequest(userId, idempotencyKey)).rejects.toMatchObject({ status: 503 });
  });

  test('acquires a row lock on the authenticated owner', async () => {
    const forUpdate = mock(async (_mode: string) => [{ id: userId }]);
    const where = mock((_condition: unknown) => ({ for: forUpdate }));
    const tx = { select: () => ({ from: () => ({ where }) }) } as unknown as Transaction;
    expect(await repository.lockLabOwner(tx, userId)).toEqual({ id: userId });
    expect(forUpdate).toHaveBeenCalledWith('update');
    expect(new PgDialect().sqlToQuery(where.mock.calls[0]![0] as SQL).params).toEqual([userId]);
  });

  test('active lookup filters by owner and both queued and running states', async () => {
    const limit = mock(async (_count: number) => []);
    const where = mock((_condition: unknown) => ({ limit }));
    spyOn(db, 'select').mockReturnValue({ from: () => ({ where }) } as unknown as ReturnType<typeof db.select>);
    expect(await repository.findActiveLab(userId)).toBeNull();
    expect(new PgDialect().sqlToQuery(where.mock.calls[0]![0] as SQL).params).toEqual([userId, 'queued', 'running']);
  });
});
