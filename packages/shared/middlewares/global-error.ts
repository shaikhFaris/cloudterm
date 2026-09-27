import { type ErrorRequestHandler } from 'express';
import { ApiError } from '../utils/ApiError';
import logger from '../utils/logger';

export const handleGlobalError: ErrorRequestHandler = (err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err && err.message.includes('JSON')) {
    return res.status(400).json({
      error: 'Invalid JSON payload',
    });
  }
  if (err instanceof ApiError) {
    logger.error(`${err.status} error | ${err.message} | ${err.debugMsg}\n ${err.stack}`);
    return res.status(err.status).json({
      error: err.message,
    });
  }
  logger.error(`500 error | ${err.message}\n ${err.stack}`);
  return res.status(500).json({
    error: 'Internal server error',
  });
};
