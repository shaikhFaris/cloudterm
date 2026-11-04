/** Stable job IDs make API retries and queued-workspace reconciliation safe. */
export async function enqueueLab(userId: string, labId: string) {
  const { labQueue } = await import('./Queue');
  return labQueue.add('create-lab', { userId, workspaceId: labId }, {
    jobId: labId,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: true,
    removeOnFail: false,
  });
}
