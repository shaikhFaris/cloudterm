import { type RequestHandler } from 'express';
import { ApiError } from 'shared/utils/ApiError';
import { createLab } from './lab-services';

export const handleCreateLab: RequestHandler = async (req, res) => {
  if (!req.user) throw new ApiError(401, 'User not authenticated.');

  const job = await createLab(req.user.id);

  res.status(202).json(job);
};