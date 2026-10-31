import type { CoreV1Api } from '@kubernetes/client-node';
import { hasKubernetesCode, requestTimeout, waitForPod, type PodPollOptions } from './pod-lifecycle';

export async function cleanupPod(
  k8sApi: CoreV1Api,
  podName: string,
  namespace: string,
  options: PodPollOptions = {},
): Promise<boolean> {
  try {
    await k8sApi.deleteNamespacedPod({
      name: podName, namespace,
      ...(options.uid ? { body: { preconditions: { uid: options.uid } } } : {}),
    }, requestTimeout());
    // A successful DELETE acknowledges termination; finalizers/grace periods may still keep the pod alive.
    await waitForPod(k8sApi, podName, namespace, 'deleted', options);
    return true;
  } catch (cleanupErr) {
    if (hasKubernetesCode(cleanupErr, 404)) return true;
    console.error(`Failed to delete pod ${podName}:`, cleanupErr);
    return false;
  }
}
