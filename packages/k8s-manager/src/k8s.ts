import * as k8s from '@kubernetes/client-node';
import { buildKubeConfig, NAMESPACE } from './k8sConfig';
import { type k8sResponse } from 'shared/types';
import { cleanupPod } from './k8sCleanup';
import { hasKubernetesCode, requestTimeout, waitForPod, type PodPollOptions } from './pod-lifecycle';
import { findOwnedWorkspace, listRunningWorkspaces, markWorkspaceDeleted, markWorkspaceRunning } from './workspace-repository';

const kc = buildKubeConfig();

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

function belongsToWorkspace(pod: k8s.V1Pod, userId: string, workspaceId: string): boolean {
  return pod.metadata?.name === `workspace-${workspaceId}` && pod.metadata.labels?.app === 'cloudterm' &&
    pod.metadata.labels.workspaceId === workspaceId &&
    (!pod.metadata.labels.userId || pod.metadata.labels.userId === userId);
}

/** Failed provisioning becomes deleted only after its pod is confirmed absent. */
export async function finalizeFailedWorkspace(userId: string, workspaceId: string): Promise<void> {
  const workspace = await findOwnedWorkspace(userId, workspaceId);
  if (!workspace || workspace.status === 'deleted') return;
  try {
    await k8sApi.readNamespacedPod({ name: `workspace-${workspaceId}`, namespace: NAMESPACE }, requestTimeout());
  } catch (error) {
    if (!hasKubernetesCode(error, 404)) throw error;
    await markWorkspaceDeleted(workspaceId, userId);
  }
}

export async function createPod(
  userId: string,
  workspaceId: string,
  options: PodPollOptions = {},
): Promise<k8sResponse<{ workspaceId: string }>> {
  let provisioningStarted = false;
  let podUid: string | undefined;
  try {
    const workspace = await findOwnedWorkspace(userId, workspaceId);
    if (!workspace || workspace.status === 'deleted') throw new Error('Workspace not found or already deleted.');
    if (workspace.status === 'running') {
      let existing: k8s.V1Pod;
      try {
        existing = await k8sApi.readNamespacedPod({ name: `workspace-${workspaceId}`, namespace: NAMESPACE }, requestTimeout());
      } catch (error) {
        if (hasKubernetesCode(error, 404)) {
          await markWorkspaceDeleted(workspaceId, userId);
          throw new Error('Workspace pod no longer exists.');
        }
        throw error;
      }
      if (!belongsToWorkspace(existing, userId, workspaceId)) throw new Error('Workspace pod ownership does not match.');
      await waitForPod(k8sApi, `workspace-${workspaceId}`, NAMESPACE, 'ready', { ...options, uid: existing.metadata?.uid });
      return { success: true, data: { workspaceId } };
    }
    provisioningStarted = true;
    // create pod
    let pod: k8s.V1Pod;
    try {
      pod = await k8sApi.createNamespacedPod({
        namespace: NAMESPACE,
        body: {
          apiVersion: 'v1',
          kind: 'Pod',
          metadata: {
            name: `workspace-${workspaceId}`,
            labels: {
              app: 'cloudterm',
              workspaceId,
              userId,
            },
          },
          spec: {
            activeDeadlineSeconds: 30,
            terminationGracePeriodSeconds: 10,
            restartPolicy: 'Never',
            containers: [
              {
                name: 'terminal',
                image: 'ubuntu:24.04',
                command: ['/bin/sh', '-c', 'sleep infinity'],
                workingDir: '/workspace',
                readinessProbe: {
                  exec: { command: ['/bin/sh', '-c', 'test -d /workspace && test -w /workspace'] },
                  periodSeconds: 1,
                  timeoutSeconds: 1,
                },
                resources: {
                  requests: {
                    cpu: '100m',
                    memory: '128Mi',
                  },
                  limits: {
                    cpu: '500m',
                    memory: '512Mi',
                  },
                },
                securityContext: {
                  allowPrivilegeEscalation: false,
                  capabilities: {
                    drop: ['ALL'],
                  },
                },
              },
            ],
          },
        },
      }, requestTimeout());
    } catch (error) {
      if (!hasKubernetesCode(error, 409)) throw error;
      // Retried jobs reuse the existing owned pod instead of creating duplicate workspaces.
      pod = await k8sApi.readNamespacedPod({ name: `workspace-${workspaceId}`, namespace: NAMESPACE }, requestTimeout());
      if (!belongsToWorkspace(pod, userId, workspaceId)) {
        provisioningStarted = false;
        throw new Error('An unrelated pod already uses this workspace name.');
      }
    }
    podUid = pod.metadata?.uid;
    await waitForPod(k8sApi, `workspace-${workspaceId}`, NAMESPACE, 'ready', { ...options, uid: podUid });
    // Update the original row only; a late completion must never revive a deleted workspace.
    if (!await markWorkspaceRunning(userId, workspaceId)) throw new Error('Workspace is no longer active.');
    return {
      success: true,
      data: {
        workspaceId,
      },
    };
  } catch (err) {
    console.error('Error:', err);
    if (provisioningStarted) {
      try {
        // Recover the UID after a lost create response, without deleting an unrelated pod.
        const pod = await k8sApi.readNamespacedPod({ name: `workspace-${workspaceId}`, namespace: NAMESPACE }, requestTimeout());
        if (belongsToWorkspace(pod, userId, workspaceId)) {
          await cleanupPod(k8sApi, `workspace-${workspaceId}`, NAMESPACE, { ...options, uid: podUid ?? pod.metadata?.uid });
        }
      } catch (cleanupError) {
        if (!hasKubernetesCode(cleanupError, 404)) console.error('Failed to inspect pod for cleanup:', cleanupError);
      }
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function cleanupWorker(options: PodPollOptions = {}): Promise<void> {
  const res = await k8sApi.listNamespacedPod({
    namespace: NAMESPACE,
    labelSelector: 'app=cloudterm',
  }, requestTimeout());

  const expiredPods = res.items.filter((pod) => ['Failed', 'Succeeded'].includes(pod.status?.phase ?? '') || pod.metadata?.deletionTimestamp);

  const results = await Promise.allSettled(
    expiredPods.map(async (pod) => {
      const name = pod.metadata?.name;
      const workspaceId = pod.metadata?.labels?.workspaceId;
      if (!name || !workspaceId || pod.metadata?.labels?.app !== 'cloudterm' || name !== `workspace-${workspaceId}`) return;

      if (await cleanupPod(k8sApi, name, NAMESPACE, { ...options, uid: pod.metadata?.uid })) {
        await markWorkspaceDeleted(workspaceId, pod.metadata?.labels?.userId);
        console.log('Deleted pod: ', name);
      }
    }),
  );
  for (const result of results) {
    if (result.status === 'rejected') console.error('Failed to persist pod cleanup:', result.reason);
  }

  // Repair records after manual pod deletion or a DB failure following successful deletion.
  const presentNames = new Set(res.items.map((pod) => pod.metadata?.name));
  for (const workspace of await listRunningWorkspaces()) {
    if (presentNames.has(`workspace-${workspace.id}`)) continue;
    try {
      await k8sApi.readNamespacedPod({ name: `workspace-${workspace.id}`, namespace: NAMESPACE }, requestTimeout());
    } catch (error) {
      if (hasKubernetesCode(error, 404)) await markWorkspaceDeleted(workspace.id, workspace.userId);
      else console.error('Failed to reconcile workspace:', error);
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startCleanupWorker(delay: number) {
  while (true) {
    try {
      await cleanupWorker();
    } catch (error) {
      console.error('Cleanup failed:', error);
    }

    await sleep(delay);
  }
}
