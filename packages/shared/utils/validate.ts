import z from 'zod';
import { type RequestHandler } from 'express';

export const validate =
  (schema: z.ZodType): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
    });
    if (!result.success) {
      const formattedErrors = result.error.issues.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
      }));
      return res.status(400).json({
        error: 'Validation Error',
        details: formattedErrors,
      });
    }
    next();
  };
