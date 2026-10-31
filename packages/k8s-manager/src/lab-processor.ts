import { createPod, finalizeFailedWorkspace } from './k8s';

export async function processLabJob(job: {
  data?: { userId?: unknown; workspaceId?: unknown };
  opts?: { attempts?: number };
  attemptsMade?: number;
}) {
  const userId = job.data?.userId;
  const workspaceId = job.data?.workspaceId;
  if (typeof userId !== 'string' || !userId || typeof workspaceId !== 'string' || !workspaceId) {
    throw new Error('User ID and workspace ID are required.');
  }
  const result = await createPod(userId, workspaceId);
  if ('error' in result || !result.success) {
    if ((job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1)) {
      try {
        await finalizeFailedWorkspace(userId, workspaceId);
      } catch (error) {
        console.error('Failed to finalize workspace:', error);
      }
    }
    throw new Error('error' in result ? result.error : 'Lab provisioning failed.');
  }
  return result.data;
}
