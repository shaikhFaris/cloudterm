import z from 'zod';

export const createLabSchema = z.object({
  body: z.strictObject({}),
});

export const getLabStatusSchema = z.object({
  params: z.strictObject({
    labId: z.uuid('Lab ID must be a valid UUID.'),
  }),
});
