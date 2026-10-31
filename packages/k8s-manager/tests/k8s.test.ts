import { afterEach, beforeEach, describe, expect, mock, spyOn } from 'bun:test';
import { test, type Mock } from 'bun:test';
import type { CoreV1Api, V1Pod, V1PodList } from '@kubernetes/client-node';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

process.env.DB_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
const namespace = 'test-cloudterm';
const userId = '83bcfe2d-bcaa-41e5-8b3a-4875ee43019a';
const workspaceId = '4d3f5c21-cfde-4e53-a7d5-bf43a513d153';
const secondId = '08ae382d-f322-44fa-92c1-f525eb517305';
const workspace = { id: workspaceId, userId, status: 'queued' as const, createdAt: new Date() };
const deletedNames = new Set<string>();
const events: string[] = [];

function pod(id = workspaceId, phase = 'Running', ready = true): V1Pod {
  return {
    metadata: { name: `workspace-${id}`, namespace, uid: `uid-${id}`, labels: { app: 'cloudterm', workspaceId: id, userId } },
    status: { phase, conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }] },
  };
}

const createNamespacedPod = mock(async (_request: Parameters<CoreV1Api['createNamespacedPod']>[0]): Promise<V1Pod> => ({}));
const readNamespacedPod = mock(async (_request: Parameters<CoreV1Api['readNamespacedPod']>[0]): Promise<V1Pod> => ({}));
const deleteNamespacedPod = mock(async (_request: Parameters<CoreV1Api['deleteNamespacedPod']>[0]): Promise<V1Pod> => ({}));
const listNamespacedPod = mock(async (_request: Parameters<CoreV1Api['listNamespacedPod']>[0]): Promise<V1PodList> => ({ items: [] }));
const client = { createNamespacedPod, readNamespacedPod, deleteNamespacedPod, listNamespacedPod };

mock.module('../src/k8sConfig', () => ({
  NAMESPACE: namespace,
  buildKubeConfig: () => ({ makeApiClient: () => client }),
}));

const repository = await import('../src/workspace-repository');
const originalMarkRunning = repository.markWorkspaceRunning;
const originalFindOwned = repository.findOwnedWorkspace;
const { db } = await import('shared/db/drizzle');
const lifecycle = await import('../src/k8s');
const { createPod, cleanupWorker } = lifecycle;
const { processLabJob } = await import('../src/lab-processor');
let findOwned: Mock<typeof repository.findOwnedWorkspace>;
let markRunning: Mock<typeof repository.markWorkspaceRunning>;
let markDeleted: Mock<typeof repository.markWorkspaceDeleted>;
let listRunning: Mock<typeof repository.listRunningWorkspaces>;
let errorLog: Mock<typeof console.error>;

function polling() {
  let time = 0;
  return { timeoutMs: 5, intervalMs: 1, now: () => time, sleep: async (ms: number) => { time += ms; } };
}

beforeEach(() => {
  deletedNames.clear();
  events.length = 0;
  createNamespacedPod.mockReset().mockImplementation(async () => { events.push('create'); return pod(workspaceId, 'Pending', false); });
  readNamespacedPod.mockReset().mockImplementation(async ({ name }) => {
    events.push('read');
    if (deletedNames.has(name)) throw { code: 404 };
    return pod(name.slice('workspace-'.length));
  });
  deleteNamespacedPod.mockReset().mockImplementation(async ({ name }) => {
    events.push('delete'); deletedNames.add(name); return {};
  });
  listNamespacedPod.mockReset().mockResolvedValue({ items: [] });
  findOwned = spyOn(repository, 'findOwnedWorkspace').mockResolvedValue(workspace);
  markRunning = spyOn(repository, 'markWorkspaceRunning').mockImplementation(async () => { events.push('running'); return true; });
  markDeleted = spyOn(repository, 'markWorkspaceDeleted').mockImplementation(async () => { events.push('deleted'); });
  listRunning = spyOn(repository, 'listRunningWorkspaces').mockResolvedValue([]);
  errorLog = spyOn(console, 'error').mockImplementation(() => {});
  spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => mock.restore());

describe('workspace provisioning', () => {
  test('updates the original owned workspace only after its pod is Ready', async () => {
    expect(await createPod(userId, workspaceId, polling())).toEqual({ success: true, data: { workspaceId } });
    expect(findOwned).toHaveBeenCalledWith(userId, workspaceId);
    expect(markRunning).toHaveBeenCalledWith(userId, workspaceId);
    expect(events).toEqual(['create', 'read', 'running']);
    const request = createNamespacedPod.mock.calls[0]?.[0];
    expect(request?.body.metadata?.labels).toMatchObject({ workspaceId, userId });
    expect(request?.body.spec?.containers[0]?.readinessProbe?.exec?.command).toEqual(['/bin/sh', '-c', 'test -d /workspace && test -w /workspace']);
    expect(deleteNamespacedPod).not.toHaveBeenCalled();
  });

  test('Running phase without Ready=True does not update the database', async () => {
    let reads = 0;
    readNamespacedPod.mockImplementation(async () => { reads += 1; return pod(workspaceId, 'Running', reads > 1); });
    expect(await createPod(userId, workspaceId, polling())).toMatchObject({ success: true });
    expect(reads).toBe(2);
    expect(markRunning).toHaveBeenCalledTimes(1);
  });

  test('waits for readiness and persistence before reporting success', async () => {
    const ready = Promise.withResolvers<V1Pod>();
    const persistence = Promise.withResolvers<boolean>();
    const readStarted = Promise.withResolvers<void>();
    const updateStarted = Promise.withResolvers<void>();
    readNamespacedPod.mockImplementation(() => { readStarted.resolve(); return ready.promise; });
    markRunning.mockImplementation(() => { updateStarted.resolve(); return persistence.promise; });
    let settled = false;
    const pending = createPod(userId, workspaceId, polling()).then((result) => { settled = true; return result; });
    await readStarted.promise;
    expect(markRunning).not.toHaveBeenCalled();
    ready.resolve(pod());
    await updateStarted.promise;
    expect(settled).toBe(false);
    persistence.resolve(true);
    expect(await pending).toMatchObject({ success: true });
  });

  test('does not create pods for missing, unowned, or deleted workspaces', async () => {
    findOwned.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ ...workspace, status: 'deleted' });
    expect(await createPod(userId, workspaceId, polling())).toMatchObject({ success: false });
    expect(await createPod(userId, workspaceId, polling())).toMatchObject({ success: false });
    expect(createNamespacedPod).not.toHaveBeenCalled();
    expect(deleteNamespacedPod).not.toHaveBeenCalled();
  });

  test('reuses an existing matching pod on a retried job', async () => {
    createNamespacedPod.mockRejectedValueOnce({ code: 409 });
    expect(await createPod(userId, workspaceId, polling())).toMatchObject({ success: true });
    expect(readNamespacedPod).toHaveBeenCalledTimes(2);
    expect(deleteNamespacedPod).not.toHaveBeenCalled();
  });

  test('a replayed job for a running workspace does not create or rewrite anything', async () => {
    findOwned.mockResolvedValue({ ...workspace, status: 'running' });
    expect(await createPod(userId, workspaceId, polling())).toMatchObject({ success: true });
    expect(createNamespacedPod).not.toHaveBeenCalled();
    expect(markRunning).not.toHaveBeenCalled();
    expect(deleteNamespacedPod).not.toHaveBeenCalled();
  });

  test('a missing pod for a running workspace is marked deleted rather than recreated', async () => {
    findOwned.mockResolvedValue({ ...workspace, status: 'running' });
    readNamespacedPod.mockRejectedValueOnce({ code: 404 });
    expect(await createPod(userId, workspaceId, polling())).toMatchObject({ success: false });
    expect(markDeleted).toHaveBeenCalledWith(workspaceId, userId);
    expect(createNamespacedPod).not.toHaveBeenCalled();
  });

  test('API errors during replay never delete an already-running workspace', async () => {
    findOwned.mockResolvedValue({ ...workspace, status: 'running' });
    readNamespacedPod.mockRejectedValueOnce(new Error('API unavailable'));
    expect(await createPod(userId, workspaceId, polling())).toMatchObject({ success: false });
    expect(markDeleted).not.toHaveBeenCalled();
    expect(deleteNamespacedPod).not.toHaveBeenCalled();
  });

  test('does not adopt or delete an unrelated conflicting pod', async () => {
    createNamespacedPod.mockRejectedValueOnce({ code: 409 });
    const unrelated = pod();
    unrelated.metadata!.labels!.userId = 'another-user';
    readNamespacedPod.mockResolvedValue(unrelated);
    expect(await createPod(userId, workspaceId, polling())).toMatchObject({ success: false });
    expect(markRunning).not.toHaveBeenCalled();
    expect(deleteNamespacedPod).not.toHaveBeenCalled();
  });

  test('times out unready pods, cleans them up, and leaves the row available for retry', async () => {
    readNamespacedPod.mockImplementation(async ({ name }) => {
      if (deletedNames.has(name)) throw { code: 404 };
      return pod(workspaceId, 'Pending', false);
    });
    const result = await createPod(userId, workspaceId, polling());
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('Timed out') });
    expect(markRunning).not.toHaveBeenCalled();
    expect(deleteNamespacedPod).toHaveBeenCalledTimes(1);
    expect(markDeleted).not.toHaveBeenCalled();
  });

  test('rejects terminal or terminating pods before marking them running', async () => {
    for (const state of ['Failed', 'Succeeded', 'terminating']) {
      deletedNames.clear();
      const terminal = pod(workspaceId, state === 'terminating' ? 'Running' : state);
      if (state === 'terminating') terminal.metadata!.deletionTimestamp = new Date();
      readNamespacedPod.mockImplementation(async ({ name }) => {
        if (deletedNames.has(name)) throw { code: 404 };
        return terminal;
      });
      expect(await createPod(userId, workspaceId, polling())).toMatchObject({ success: false });
    }
    expect(markRunning).not.toHaveBeenCalled();
  });

  test('cleans up after a lost creation response while preserving the original failure', async () => {
    createNamespacedPod.mockRejectedValueOnce(new Error('Creation response lost'));
    expect(await createPod(userId, workspaceId, polling())).toEqual({ success: false, error: 'Creation response lost' });
    expect(deleteNamespacedPod).toHaveBeenCalledWith(expect.objectContaining({
      name: `workspace-${workspaceId}`, body: { preconditions: { uid: `uid-${workspaceId}` } },
    }), expect.anything());
  });

  test('does not revive a workspace deleted while its pod was starting', async () => {
    markRunning.mockResolvedValue(false);
    expect(await createPod(userId, workspaceId, polling())).toMatchObject({ success: false });
    expect(deleteNamespacedPod).toHaveBeenCalledTimes(1);
  });

  test('cleanup failures cannot hide the original database error', async () => {
    markRunning.mockRejectedValueOnce(new Error('Database unavailable'));
    deleteNamespacedPod.mockRejectedValueOnce(new Error('Deletion failed'));
    expect(await createPod(userId, workspaceId, polling())).toEqual({ success: false, error: 'Database unavailable' });
    expect(errorLog).toHaveBeenCalledWith(`Failed to delete pod workspace-${workspaceId}:`, expect.any(Error));
  });

  test('a replacement pod is protected by the original UID precondition', async () => {
    const replacement = pod();
    replacement.metadata!.uid = 'replacement-uid';
    readNamespacedPod.mockResolvedValue(replacement);
    deleteNamespacedPod.mockRejectedValueOnce({ code: 409 });
    expect(await createPod(userId, workspaceId, polling())).toMatchObject({ success: false });
    expect(markRunning).not.toHaveBeenCalled();
    expect(deleteNamespacedPod).toHaveBeenCalledWith(expect.objectContaining({
      body: { preconditions: { uid: `uid-${workspaceId}` } },
    }), expect.anything());
  });
});

describe('workspace cleanup and reconciliation', () => {
  test('marks the matching workspace deleted only after the pod disappears', async () => {
    listNamespacedPod.mockResolvedValue({ items: [pod(workspaceId, 'Failed', false)] });
    await cleanupWorker(polling());
    expect(markDeleted).toHaveBeenCalledWith(workspaceId, userId);
    expect(events).toEqual(['delete', 'read', 'deleted']);
  });

  test('does not mark a workspace deleted while termination is still in progress', async () => {
    listNamespacedPod.mockResolvedValue({ items: [pod(workspaceId, 'Failed', false)] });
    readNamespacedPod.mockResolvedValue(pod());
    await cleanupWorker(polling());
    expect(markDeleted).not.toHaveBeenCalled();
  });

  test('treats an already-absent pod as deleted', async () => {
    listNamespacedPod.mockResolvedValue({ items: [pod(workspaceId, 'Failed', false)] });
    deleteNamespacedPod.mockRejectedValueOnce({ code: 404 });
    await cleanupWorker(polling());
    expect(markDeleted).toHaveBeenCalledWith(workspaceId, userId);
  });

  test('does not update the database if Kubernetes rejects deletion', async () => {
    listNamespacedPod.mockResolvedValue({ items: [pod(workspaceId, 'Failed', false)] });
    deleteNamespacedPod.mockRejectedValueOnce({ code: 403 });
    await cleanupWorker(polling());
    expect(markDeleted).not.toHaveBeenCalled();
  });

  test('reconciles manually deleted running pods after confirming 404', async () => {
    listRunning.mockResolvedValue([{ id: workspaceId, userId }]);
    readNamespacedPod.mockRejectedValueOnce({ code: 404 });
    await cleanupWorker(polling());
    expect(markDeleted).toHaveBeenCalledWith(workspaceId, userId);
    expect(deleteNamespacedPod).not.toHaveBeenCalled();
  });

  test('a missing list entry is not enough to delete a running workspace record', async () => {
    listRunning.mockResolvedValue([{ id: workspaceId, userId }]);
    await cleanupWorker(polling());
    expect(readNamespacedPod).toHaveBeenCalled();
    expect(markDeleted).not.toHaveBeenCalled();
  });

  test('API outages never turn live workspaces into deleted records', async () => {
    listRunning.mockResolvedValue([{ id: workspaceId, userId }]);
    readNamespacedPod.mockRejectedValueOnce({ code: 503 });
    await cleanupWorker(polling());
    expect(markDeleted).not.toHaveBeenCalled();
    listNamespacedPod.mockRejectedValueOnce(new Error('Kubernetes unavailable'));
    await expect(cleanupWorker(polling())).rejects.toThrow('Kubernetes unavailable');
    expect(markDeleted).not.toHaveBeenCalled();
  });

  test('repairs a DB failure that occurred after successful pod deletion', async () => {
    listNamespacedPod.mockResolvedValueOnce({ items: [pod(workspaceId, 'Failed', false)] }).mockResolvedValueOnce({ items: [] });
    listRunning.mockResolvedValue([{ id: workspaceId, userId }]);
    markDeleted.mockRejectedValueOnce(new Error('Database unavailable'));
    await cleanupWorker(polling());
    await cleanupWorker(polling());
    expect(markDeleted).toHaveBeenCalledTimes(2);
  });

  test('one cleanup failure does not prevent another workspace being updated', async () => {
    listNamespacedPod.mockResolvedValue({ items: [pod(workspaceId, 'Failed', false), pod(secondId, 'Failed', false)] });
    markDeleted.mockRejectedValueOnce(new Error('One update failed'));
    await cleanupWorker(polling());
    expect(markDeleted).toHaveBeenCalledWith(secondId, userId);
  });

  test('skips pods without matching application labels and workspace names', async () => {
    const unrelated = pod(workspaceId, 'Failed');
    unrelated.metadata!.name = 'unrelated-pod';
    const unlabeled = pod(secondId, 'Failed');
    unlabeled.metadata!.labels = {};
    listNamespacedPod.mockResolvedValue({ items: [unrelated, unlabeled] });
    await cleanupWorker(polling());
    expect(deleteNamespacedPod).not.toHaveBeenCalled();
    expect(markDeleted).not.toHaveBeenCalled();
  });
});

describe('queue processing', () => {
  test('throws provisioning errors so BullMQ retries them', async () => {
    spyOn(lifecycle, 'createPod').mockResolvedValue({ success: false, error: 'Not ready' });
    const finalize = spyOn(lifecycle, 'finalizeFailedWorkspace').mockResolvedValue();
    await expect(processLabJob({ data: { userId, workspaceId }, opts: { attempts: 3 }, attemptsMade: 0 })).rejects.toThrow('Not ready');
    expect(finalize).not.toHaveBeenCalled();
  });

  test('final failure is marked deleted only after confirming no pod remains', async () => {
    spyOn(lifecycle, 'createPod').mockResolvedValue({ success: false, error: 'Not ready' });
    readNamespacedPod.mockRejectedValueOnce({ code: 404 });
    await expect(processLabJob({ data: { userId, workspaceId }, opts: { attempts: 3 }, attemptsMade: 2 })).rejects.toThrow('Not ready');
    expect(markDeleted).toHaveBeenCalledWith(workspaceId, userId);
  });

  test('final failure does not claim deletion while the pod still exists', async () => {
    spyOn(lifecycle, 'createPod').mockResolvedValue({ success: false, error: 'Not ready' });
    await expect(processLabJob({ data: { userId, workspaceId }, opts: { attempts: 3 }, attemptsMade: 2 })).rejects.toThrow('Not ready');
    expect(markDeleted).not.toHaveBeenCalled();
  });

  test('finalization errors preserve the original provisioning failure', async () => {
    spyOn(lifecycle, 'createPod').mockResolvedValue({ success: false, error: 'Not ready' });
    readNamespacedPod.mockRejectedValueOnce({ code: 404 });
    markDeleted.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(processLabJob({ data: { userId, workspaceId }, opts: { attempts: 3 }, attemptsMade: 2 })).rejects.toThrow('Not ready');
    expect(errorLog).toHaveBeenCalledWith('Failed to finalize workspace:', expect.any(Error));
  });

  test('successful processing returns the original workspace ID', async () => {
    expect(await processLabJob({ data: { userId, workspaceId } })).toEqual({ workspaceId });
  });

  test('invalid job data is rejected instead of silently completing', async () => {
    await expect(processLabJob({ data: {} })).rejects.toThrow('required');
    expect(createNamespacedPod).not.toHaveBeenCalled();
  });
});

describe('workspace query scoping', () => {
  test('running updates filter by workspace, owner, and active status', async () => {
    const returning = mock(async () => [{ id: workspaceId }]);
    const where = mock((_condition: unknown) => ({ returning }));
    const set = mock((_values: unknown) => ({ where }));
    spyOn(db, 'update').mockReturnValue({ set } as unknown as ReturnType<typeof db.update>);
    expect(await originalMarkRunning(userId, workspaceId)).toBe(true);
    const sql = new PgDialect().sqlToQuery(where.mock.calls[0]![0] as SQL);
    expect(sql.params).toEqual([workspaceId, userId, 'queued', 'running']);
    expect(set).toHaveBeenCalledWith({ status: 'running' });
  });

  test('workspace lookup always scopes the workspace ID to its owner', async () => {
    const where = mock(async (_condition: unknown) => [workspace]);
    const from = mock((_table: unknown) => ({ where }));
    spyOn(db, 'select').mockReturnValue({ from } as unknown as ReturnType<typeof db.select>);
    expect(await originalFindOwned(userId, workspaceId)).toEqual(workspace);
    const sql = new PgDialect().sqlToQuery(where.mock.calls[0]![0] as SQL);
    expect(sql.params).toEqual([workspaceId, userId]);
  });
});
