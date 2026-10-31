import { type RequestHandler } from 'express';
import { ApiError } from 'shared/utils/ApiError';
import { createLab, getLabStatus } from './lab-services';
import { getLabStatusSchema } from './lab-schema';

export const handleCreateLab: RequestHandler = async (req, res) => {
  if (!req.user) throw new ApiError(401, 'User not authenticated.');

  const job = await createLab(req.user.id);

  res.status(202).json(job);
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
