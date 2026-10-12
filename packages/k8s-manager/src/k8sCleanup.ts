import type { CoreV1Api } from '@kubernetes/client-node';

export async function cleanupPod(
  k8sApi: CoreV1Api,
  podName: string,
  namespace: string,
): Promise<void> {
  try {
    await k8sApi.deleteNamespacedPod({ name: podName, namespace });
  } catch (cleanupErr) {
    const podNotFound =
      typeof cleanupErr === 'object' &&
      cleanupErr !== null &&
      'code' in cleanupErr &&
      cleanupErr.code === 404;

    if (!podNotFound) {
      console.error(`Failed to delete pod ${podName}:`, cleanupErr);
    }
  }
}
