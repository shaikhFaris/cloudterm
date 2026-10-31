import { Observable, type ConfigurationOptions, type CoreV1Api, type V1Pod } from '@kubernetes/client-node';

export type PodPollOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  uid?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export function hasKubernetesCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** Bound each API request while preserving kubeconfig authentication middleware. */
export function requestTimeout(timeoutMs = 10_000): ConfigurationOptions {
  return {
    middlewareMergeStrategy: 'append',
    middleware: [{
      pre(context) {
        context.setSignal(AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))));
        return new Observable(Promise.resolve(context));
      },
      post(context) { return new Observable(Promise.resolve(context)); },
    }],
  };
}

export function isPodReady(pod: V1Pod): boolean {
  return !pod.metadata?.deletionTimestamp && pod.status?.phase === 'Running' &&
    pod.status.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True') === true;
}

export async function waitForPod(
  api: CoreV1Api, name: string, namespace: string, target: 'ready' | 'deleted',
  options: PodPollOptions = {},
): Promise<void> {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + (options.timeoutMs ?? (target === 'ready' ? 60_000 : 30_000));
  const interval = options.intervalMs ?? (target === 'ready' ? 1_000 : 250);

  while (now() < deadline) {
    let pod: V1Pod;
    try {
      pod = await api.readNamespacedPod({ name, namespace }, requestTimeout(Math.min(10_000, deadline - now())));
    } catch (error) {
      if (target === 'deleted' && hasKubernetesCode(error, 404)) return;
      throw error;
    }
    if (options.uid && pod.metadata?.uid !== options.uid) throw new Error(`Pod ${name} was replaced while waiting for ${target}.`);
    if (target === 'ready') {
      if (pod.metadata?.deletionTimestamp || ['Failed', 'Succeeded'].includes(pod.status?.phase ?? '')) {
        throw new Error(`Pod ${name} terminated before becoming ready.`);
      }
      if (isPodReady(pod)) return;
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(interval, remaining));
  }
  throw new Error(`Timed out waiting for pod ${name} to be ${target}.`);
}
