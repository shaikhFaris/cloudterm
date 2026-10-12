import { afterEach, beforeEach, describe, expect, mock, spyOn, test, type Mock } from 'bun:test';
import type { CoreV1Api, V1Pod } from '@kubernetes/client-node';
import { workspaceTable } from 'shared/db/schema/schema';

const namespace = 'test-cloudterm';
const userId = '83bcfe2d-bcaa-41e5-8b3a-4875ee43019a';
const workspaceId = '4d3f5c21-cfde-4e53-a7d5-bf43a513d153';
const events: string[] = [];
const createNamespacedPod = mock(
  async (_request: Parameters<CoreV1Api['createNamespacedPod']>[0]): Promise<V1Pod> => ({}),
);
const deleteNamespacedPod = mock(
  async (_request: Parameters<CoreV1Api['deleteNamespacedPod']>[0]): Promise<V1Pod> => ({}),
);
const values = mock(async (_record: typeof workspaceTable.$inferInsert) => {});
const insert = mock((_table: typeof workspaceTable) => ({ values }));
const client = { createNamespacedPod, deleteNamespacedPod };

// Register before importing k8s.ts to avoid kubeconfig refreshes and DB connections.
mock.module('../src/k8sConfig', () => ({
  NAMESPACE: namespace,
  buildKubeConfig: () => ({ makeApiClient: () => client }),
}));
mock.module('shared/db/drizzle', () => ({ db: { insert } }));

const { createPod } = await import('../src/k8s');
let errorLog: Mock<typeof console.error>;

beforeEach(() => {
  events.length = 0;
  createNamespacedPod.mockReset();
  createNamespacedPod.mockImplementation(async () => {
    events.push('create');
    return {};
  });
  deleteNamespacedPod.mockReset();
  deleteNamespacedPod.mockImplementation(async () => {
    events.push('delete');
    return {};
  });
  values.mockReset();
  values.mockImplementation(async () => {
    events.push('insert');
  });
  insert.mockClear();
  errorLog = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorLog.mockRestore();
});

function createdPodName(): string {
  const request = createNamespacedPod.mock.calls[0]?.[0];
  expect(request?.namespace).toBe(namespace);
  const name = request?.body.metadata?.name;
  expect(name).toBe(`workspace-${workspaceId}`);
  return name!;
}

function expectCleanup(): void {
  expect(deleteNamespacedPod).toHaveBeenCalledTimes(1);
  expect(deleteNamespacedPod).toHaveBeenCalledWith({
    name: `workspace-${workspaceId}`,
    namespace,
  });
}

describe('createPod', () => {
  test('creates a pod with the supplied workspace ID, inserts the user record, and returns that ID', async () => {
    const result = await createPod(userId, workspaceId);
    const podName = createdPodName();
    const labels = createNamespacedPod.mock.calls[0]?.[0].body.metadata?.labels;

    expect(createNamespacedPod).toHaveBeenCalledTimes(1);
    expect(labels).toMatchObject({ app: 'cloudterm', workspaceId });
    expect(podName).toBe(`workspace-${workspaceId}`);
    expect(insert).toHaveBeenCalledWith(workspaceTable);
    expect(values).toHaveBeenCalledWith({ userId, status: 'running' });
    expect(result).toEqual({ success: true, data: { workspaceId } });
    expect(events).toEqual(['create', 'insert']);
    expect(deleteNamespacedPod).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  test('waits for creation before inserting, and for persistence before returning success', async () => {
    const creation = Promise.withResolvers<V1Pod>();
    const persistence = Promise.withResolvers<void>();
    const insertStarted = Promise.withResolvers<void>();
    createNamespacedPod.mockImplementation(() => creation.promise);
    values.mockImplementation(() => {
      insertStarted.resolve();
      return persistence.promise;
    });

    let settled = false;
    const pending = createPod(userId, workspaceId).then((result) => {
      settled = true;
      return result;
    });
    expect(insert).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    creation.resolve({});
    await insertStarted.promise;
    expect(insert).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    persistence.resolve();
    expect(await pending).toEqual({
      success: true,
      data: { workspaceId },
    });
  });

  test('deletes the created pod when the DB insert fails', async () => {
    values.mockRejectedValueOnce(new Error('DB insert failed'));

    expect(await createPod(userId, workspaceId)).toEqual({ success: false, error: 'DB insert failed' });
    expectCleanup();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  test('attempts cleanup after a creation error and skips the DB insert', async () => {
    createNamespacedPod.mockRejectedValueOnce(new Error('Creation response lost'));

    expect(await createPod(userId, workspaceId)).toEqual({ success: false, error: 'Creation response lost' });
    expect(insert).not.toHaveBeenCalled();
    expectCleanup();
  });

  test('treats a missing pod during cleanup as already deleted', async () => {
    createNamespacedPod.mockRejectedValueOnce(new Error('Creation failed'));
    deleteNamespacedPod.mockRejectedValueOnce({ code: 404 });

    expect(await createPod(userId, workspaceId)).toEqual({ success: false, error: 'Creation failed' });
    expectCleanup();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  test('logs a cleanup failure while preserving the original DB error', async () => {
    const cleanupError = new Error('Deletion failed');
    values.mockRejectedValueOnce(new Error('DB insert failed'));
    deleteNamespacedPod.mockRejectedValueOnce(cleanupError);

    expect(await createPod(userId, workspaceId)).toEqual({ success: false, error: 'DB insert failed' });
    expectCleanup();
    expect(errorLog).toHaveBeenCalledWith(
      `Failed to delete pod ${createdPodName()}:`,
      cleanupError,
    );
  });

  test('converts non-Error rejections to a response string', async () => {
    values.mockRejectedValueOnce('DB unavailable');

    expect(await createPod(userId, workspaceId)).toEqual({ success: false, error: 'DB unavailable' });
    expectCleanup();
  });
});
