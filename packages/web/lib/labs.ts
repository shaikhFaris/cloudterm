'use client';

import z from 'zod';
import { api } from './api-client';

const labSchema = z.object({ labId: z.uuid(), status: z.enum(['queued', 'running', 'deleted']) });
export type Lab = z.infer<typeof labSchema>;

export async function createLab(idempotencyKey: string): Promise<Lab> {
  const { data } = await api.post('/labs/create', {}, { headers: { 'Idempotency-Key': idempotencyKey } });
  return labSchema.parse(data);
}

export async function getActiveLab(signal?: AbortSignal): Promise<Lab | null> {
  const { data } = await api.get('/labs/active', { signal });
  return data === null ? null : labSchema.parse(data);
}

export async function getLabStatus(labId: string, signal?: AbortSignal): Promise<Lab> {
  const id = z.uuid().parse(labId);
  const { data } = await api.get(`/labs/${id}/status`, { signal });
  const lab = labSchema.parse(data);
  if (lab.labId !== id) throw new Error('Unexpected lab status response.');
  return lab;
}

export function labPollInterval(lab?: Lab | null): number | false {
  if (!lab || lab.status === 'deleted') return false;
  return lab.status === 'queued' ? 2_000 : 5_000;
}
