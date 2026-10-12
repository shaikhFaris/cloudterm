import * as k8s from '@kubernetes/client-node';
import { buildKubeConfig, NAMESPACE } from './k8sConfig';
import { db } from 'shared/db/drizzle';
import { workspaceTable } from 'shared/db/schema/schema';
import { type k8sResponse } from 'shared/types';
import { cleanupPod } from './k8sCleanup';

const kc = buildKubeConfig();

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

export async function createPod(
  userId: string,
  workspaceId: string,
): Promise<k8sResponse<{ workspaceId: string }>> {
  try {
    // create pod
    const res = await k8sApi.createNamespacedPod({
      namespace: NAMESPACE,
      body: {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
          name: `workspace-${workspaceId}`,
          labels: {
            app: 'cloudterm',
            workspaceId,
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
    });
    const podId = `${workspaceId}`;
    // add in DB
    await db.insert(workspaceTable).values({
      status: 'running',
      userId: userId,
    });
    return {
      success: true,
      data: {
        workspaceId: podId,
      },
    };
  } catch (err) {
    console.error('Error:', err);
    // Clean up even if pod creation succeeded but its response was lost.
    await cleanupPod(k8sApi, `workspace-${workspaceId}`, NAMESPACE);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function cleanupWorker(): Promise<void> {
  try {
    const res = await k8sApi.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: 'app=cloudterm',
      fieldSelector: 'status.phase=Failed',
    });

    const expiredPods = res.items.filter((pod) => pod.status?.reason === 'DeadlineExceeded');

    await Promise.all(
      expiredPods.map(async (pod) => {
        const name = pod.metadata?.name;
        if (!name) return;

        await k8sApi.deleteNamespacedPod({
          name,
          namespace: NAMESPACE,
        });
        console.log('Deleted pod: ', name);
      }),
    );
  } catch (error) {
    console.log(error);
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
