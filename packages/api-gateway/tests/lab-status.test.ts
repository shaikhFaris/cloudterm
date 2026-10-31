import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Request, Response } from 'express';
import { ApiError } from 'shared/utils/ApiError';

const userId = '83bcfe2d-bcaa-41e5-8b3a-4875ee43019a';
const labId = '4d3f5c21-cfde-4e53-a7d5-bf43a513d153';
const getLabStatus = mock(async (_userId: string, _labId: string): Promise<unknown> => ({}));

// Isolate the handler from database and queue connections; status retrieval is intentionally a stub.
mock.module('../src/modules/lab/lab-services', () => ({
  createLab: mock(),
  getLabStatus,
}));

const { handleGetLabStatus } = await import('../src/modules/lab/lab-controller');

beforeEach(() => getLabStatus.mockReset());

function response() {
  const res = { status: mock(), json: mock() };
  res.status.mockReturnValue(res);
  return res;
}

describe('lab status handler', () => {
  test('requires an authenticated user before calling the service', async () => {
    await expect(handleGetLabStatus({ params: { labId } } as unknown as Request,
      response() as unknown as Response, mock())).rejects.toMatchObject({ status: 401 });
    expect(getLabStatus).not.toHaveBeenCalled();
  });

  test('rejects missing, malformed, and non-string lab IDs before calling the service', async () => {
    for (const invalidId of [undefined, '', 'not-a-uuid', ['one', 'two'], 123]) {
      const res = response();
      await handleGetLabStatus({ user: { id: userId }, params: { labId: invalidId } } as unknown as Request,
        res as unknown as Response, mock());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Validation Error', details: [
        { path: 'params.labId', message: expect.any(String) },
      ] });
    }
    expect(getLabStatus).not.toHaveBeenCalled();
  });

  test('passes the authenticated user and validated lab ID to the status service', async () => {
    const status = { status: 'running' };
    getLabStatus.mockResolvedValue(status);
    const res = response();
    await handleGetLabStatus({ user: { id: userId }, params: { labId } } as unknown as Request,
      res as unknown as Response, mock());
    expect(getLabStatus).toHaveBeenCalledWith(userId, labId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(status);
  });

  test('propagates service errors to the global error handler', async () => {
    getLabStatus.mockRejectedValue(new ApiError(501, 'Not implemented'));
    await expect(handleGetLabStatus({ user: { id: userId }, params: { labId } } as unknown as Request,
      response() as unknown as Response, mock())).rejects.toMatchObject({ status: 501 });
  });
});
