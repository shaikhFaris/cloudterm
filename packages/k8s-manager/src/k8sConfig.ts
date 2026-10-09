import { KubeConfig } from '@kubernetes/client-node';
import { spawnSync } from 'bun';
import YAML from 'yaml';
import { readFileSync, writeFileSync } from 'node:fs';

/*
 * Bun + Kubernetes: certificate-free auth that works both locally and in-cluster.
 * Drop-in snippet for any project.
 *
 * 1. Apply the YAML at the bottom once to your cluster.
 * 2. Import buildKubeConfig() and use it instead of manual kc.loadFromDefault/Cluster.
 * 3. Done — Bun no longer needs client certs and won't fall back to system:anonymous.
 */

// ----- configuration --------------------------------------------------------
const SA_NAME = process.env.K8S_SA_NAME || 'cloudterm-worker';
const NAMESPACE = process.env.K8S_NAMESPACE || 'cloudterm';
const TOKEN_REFRESH_MIN = Number(process.env.K8S_TOKEN_REFRESH_MIN || 50);

// ----- helpers --------------------------------------------------------------
function kubeconfigPath(): string {
  return process.env.KUBECONFIG || `${process.env.HOME || process.env.USERPROFILE}/.kube/config`;
}

function refreshSaToken(): void {
  const proc = spawnSync(['kubectl', '-n', NAMESPACE, 'create', 'token', SA_NAME]);
  if (proc.exitCode !== 0) {
    console.error('[auth] kubectl create token failed:', proc.stderr.toString());
    return;
  }
  const token = proc.stdout.toString().trim();
  const doc = YAML.parse(readFileSync(kubeconfigPath(), 'utf8'));

  // ensure user
  let user = doc.users.find((u: any) => u.name === SA_NAME);
  if (!user) {
    user = { name: SA_NAME, user: {} };
    doc.users.push(user);
  }
  user.user = { token };

  // ensure context
  let ctx = doc.contexts.find((c: any) => c.name === 'bun-local');
  if (!ctx) {
    ctx = {
      name: 'bun-local',
      context: {
        cluster: doc.clusters[0].name,
        user: SA_NAME,
      },
    };
    doc.contexts.push(ctx);
  }
  doc['current-context'] = ctx.name;

  writeFileSync(kubeconfigPath(), YAML.stringify(doc));
  console.log('[auth] kubeconfig updated with fresh token');
}

// ----- public: buildKubeConfig ---------------------------------------------
export function buildKubeConfig(): KubeConfig {
  const kc = new KubeConfig();

  if (process.env.KUBERNETES_SERVICE_HOST) {
    // running inside a Pod — SA token is already mounted
    kc.loadFromCluster();
    return kc;
  }

  // local: inject or refresh short-lived SA token every TOKEN_REFRESH_MIN minutes
  refreshSaToken();
  setInterval(refreshSaToken, TOKEN_REFRESH_MIN * 60_000);

  kc.loadFromDefault();
  kc.setCurrentContext('bun-local');
  return kc;
}

/* --------------------------------------------------------------------------
YAML manifest (apply once)
-----------------------------------------------------------------------------
apiVersion: v1
kind: Namespace
metadata:
  name: ci
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ci-worker
  namespace: ci
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ci-worker-full
rules:
  - apiGroups: ["", "batch", "apps"]
    resources: ["pods", "pods/log", "jobs", "secrets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ci-worker-full
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ci-worker-full
subjects:
  - kind: ServiceAccount
    name: ci-worker
    namespace: ci
-----------------------------------------------------------------------------
How this fixes Bun mTLS issue (short):
  • Bun's https ignores client-certs ⇒ kube-api falls back to anonymous ⇒ 403.
  • ServiceAccount bearer token needs no certs. In-cluster token is mounted;
    locally we generate the same token with kubectl and write it into kubeconfig.
  • Bun now authenticates via Authorization: Bearer … — problem solved.
*/
