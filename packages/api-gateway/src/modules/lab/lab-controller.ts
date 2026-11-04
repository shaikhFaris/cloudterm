import { type RequestHandler } from 'express';
import { ApiError } from 'shared/utils/ApiError';
import { createLab, getActiveLab, getLabStatus } from './lab-services';
import { getLabStatusSchema, idempotencyKeySchema } from './lab-schema';

export const handleCreateLab: RequestHandler = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) throw new ApiError(401, 'User not authenticated.');
  const key = idempotencyKeySchema.safeParse(req.get('Idempotency-Key'));
  if (!key.success) throw new ApiError(400, 'Idempotency-Key must be a UUID.');
  const lab = await createLab(req.user.id, key.data);
  res.status(lab.status === 'queued' ? 202 : 200).json(lab);
};

export const handleGetActiveLab: RequestHandler = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) throw new ApiError(401, 'User not authenticated.');
  res.status(200).json(await getActiveLab(req.user.id));
};

export const handleGetLabStatus: RequestHandler = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) throw new ApiError(401, 'User not authenticated.');

  const result = getLabStatusSchema.safeParse({ params: req.params });
  if (!result.success) {
    res.status(400).json({
      error: 'Validation Error',
      details: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  const status = await getLabStatus(req.user.id, result.data.params.labId);
  res.status(200).json(status);
};
