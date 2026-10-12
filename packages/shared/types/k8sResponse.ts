export type k8sResponse<T = unknown> =
  | { success: boolean; data: T }
  | { success: boolean; error: string };
