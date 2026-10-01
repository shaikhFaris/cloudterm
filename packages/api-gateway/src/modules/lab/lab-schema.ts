import z from 'zod';

export const createLabSchema = z.object({
  body: z.strictObject({}),
});