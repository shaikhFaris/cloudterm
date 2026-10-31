import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { Request, Response } from 'express';
import { ApiError } from 'shared/utils/ApiError';

const userId = '83bcfe2d-bcaa-41e5-8b3a-4875ee43019a';
const labId = '4d3f5c21-cfde-4e53-a7d5-bf43a513d153';
process.env.DB_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
const services = await import('../src/modules/lab/lab-services');
const { handleGetLabStatus } = await import('../src/modules/lab/lab-controller');
let getLabStatus: ReturnType<typeof spyOn<typeof services, 'getLabStatus'>>;
afterEach(() => mock.restore());

function response() {
  const res = { status: mock(), json: mock(), set: mock() };
  res.status.mockReturnValue(res);
  return res;
}

describe('lab status handler', () => {
  beforeEach(() => {
    getLabStatus = spyOn(services, 'getLabStatus');
  });

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
    const status = { labId, status: 'running' as const };
    getLabStatus.mockResolvedValue(status);
    const res = response();
    await handleGetLabStatus({ user: { id: userId }, params: { labId } } as unknown as Request,
      res as unknown as Response, mock());
    expect(getLabStatus).toHaveBeenCalledWith(userId, labId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(status);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  test('propagates service errors to the global error handler', async () => {
    getLabStatus.mockRejectedValue(new ApiError(404, 'Lab not found.'));
    await expect(handleGetLabStatus({ user: { id: userId }, params: { labId } } as unknown as Request,
      response() as unknown as Response, mock())).rejects.toMatchObject({ status: 404 });
  });
});
