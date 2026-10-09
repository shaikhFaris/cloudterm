import * as k8s from '@kubernetes/client-node';
import { buildKubeConfig } from './k8sConfig';

const kc = buildKubeConfig();

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

export async function listPods() {
  try {
    const res = await k8sApi.listNamespacedPod({ namespace: 'cloudterm' });
    console.log(res.items);

    // console.log(
    //   'Pods:',
    //   res.items.map((pod) => pod.metadata?.name),
    // );
  } catch (err) {
    console.error('Error:', err);
  }
}

listPods();
