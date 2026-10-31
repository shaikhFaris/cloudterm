const returnPaths = new Set(['/dashboard', '/dashboard/new-labs']);

/** Add new protected destinations explicitly; never accept arbitrary redirect URLs. */
export function getAuthReturnPath(value: unknown): string {
  return typeof value === 'string' && returnPaths.has(value) ? value : '/dashboard';
}

export function getRenewalLocation(returnTo: string): string {
  return `/auth/renew?${new URLSearchParams({ returnTo: getAuthReturnPath(returnTo) })}`;
}

export function getRenewedLocation(returnTo: unknown, now = Date.now()): string {
  // A failed check after renewal must go to login instead of creating a redirect loop.
  return `${getAuthReturnPath(returnTo)}?authRenewed=${now}`;
}

export function hasRecentRenewal(value: unknown, now?: number): boolean {
  if (typeof value !== 'string' || !/^\d{13}$/.test(value)) return false;
  return Math.abs((now ?? Date.now()) - Number(value)) < 30_000;
}
