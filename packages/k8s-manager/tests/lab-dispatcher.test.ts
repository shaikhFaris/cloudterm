import { afterEach, expect, mock, spyOn, test } from 'bun:test';

process.env.DB_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
const repository = await import('../src/workspace-repository');
const jobs = await import('shared/redis/lab-jobs');
const { dispatchQueuedLabs } = await import('../src/lab-dispatcher');
afterEach(() => mock.restore());

test('dispatches committed queued intents after an API crash without inserting more workspaces', async () => {
  spyOn(repository, 'listQueuedWorkspaces').mockResolvedValue([{ id: 'lab-one', userId: 'user-one' }]);
  const enqueue = spyOn(jobs, 'enqueueLab').mockResolvedValue({} as Awaited<ReturnType<typeof jobs.enqueueLab>>);
  await dispatchQueuedLabs();
  expect(enqueue).toHaveBeenCalledWith('user-one', 'lab-one');
});

test('a failed dispatch does not block other users\' queued workspaces', async () => {
  spyOn(repository, 'listQueuedWorkspaces').mockResolvedValue([
    { id: 'lab-one', userId: 'user-one' }, { id: 'lab-two', userId: 'user-two' },
  ]);
  const enqueue = spyOn(jobs, 'enqueueLab').mockRejectedValueOnce(new Error('Redis unavailable'))
    .mockResolvedValueOnce({} as Awaited<ReturnType<typeof jobs.enqueueLab>>);
  spyOn(console, 'error').mockImplementation(() => {});
  await dispatchQueuedLabs();
  expect(enqueue).toHaveBeenCalledTimes(2);
});

test('database outages cannot enqueue speculative workspaces', async () => {
  spyOn(repository, 'listQueuedWorkspaces').mockRejectedValue(new Error('Database unavailable'));
  const enqueue = spyOn(jobs, 'enqueueLab');
  await expect(dispatchQueuedLabs()).rejects.toThrow('Database unavailable');
  expect(enqueue).not.toHaveBeenCalled();
});
