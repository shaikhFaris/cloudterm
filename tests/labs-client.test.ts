import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { api } from '../packages/web/lib/api-client';
import { createLab, getActiveLab, getLabStatus, labPollInterval } from '../packages/web/lib/labs';

const labId = '4d3f5c21-cfde-4e53-a7d5-bf43a513d153';
afterEach(() => mock.restore());

test('creation uses authenticated Axios and preserves the caller\'s idempotency key', async () => {
  const post = spyOn(api, 'post').mockResolvedValue({ data: { labId, status: 'queued', jobId: labId } });
  expect(await createLab(labId)).toEqual({ labId, status: 'queued' });
  expect(post).toHaveBeenCalledWith('/labs/create', {}, { headers: { 'Idempotency-Key': labId } });
});

test('active-lab recovery handles no lab and forwards cancellation', async () => {
  const signal = new AbortController().signal;
  const get = spyOn(api, 'get').mockResolvedValueOnce({ data: null })
    .mockResolvedValueOnce({ data: { labId, status: 'running' } });
  expect(await getActiveLab(signal)).toBeNull();
  expect(await getActiveLab(signal)).toEqual({ labId, status: 'running' });
  expect(get).toHaveBeenCalledWith('/labs/active', { signal });
});

test('status polling uses the owned lab endpoint and can be cancelled', async () => {
  const signal = new AbortController().signal;
  const get = spyOn(api, 'get').mockResolvedValue({ data: { labId, status: 'queued' } });
  expect(await getLabStatus(labId, signal)).toEqual({ labId, status: 'queued' });
  expect(get).toHaveBeenCalledWith(`/labs/${labId}/status`, { signal });
});

test('malformed statuses and mismatched workspace responses are rejected', async () => {
  const get = spyOn(api, 'get');
  for (const data of [{ labId, status: 'made-up' }, {}, { labId: 'not-a-uuid', status: 'running' },
    { labId: 'ad8f6b26-ec5d-44ea-9984-5f4978beea8f', status: 'running' }]) {
    get.mockResolvedValueOnce({ data });
    await expect(getLabStatus(labId)).rejects.toThrow();
  }
  get.mockClear();
  await expect(getLabStatus('../auth/logout')).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});

test('polling waits two seconds during provisioning, five while running, and stops after deletion', () => {
  expect(labPollInterval({ labId, status: 'queued' })).toBe(2_000);
  expect(labPollInterval({ labId, status: 'running' })).toBe(5_000);
  expect(labPollInterval({ labId, status: 'deleted' })).toBe(false);
});
