import 'server-only';

export function getAuthGatewayUrl(): string {
  return process.env.API_GATEWAY_URL ?? 'http://localhost:3500';
}

/** An explicit public origin avoids trusting Host/X-Forwarded-Host for CSRF checks. */
export function getAppOrigin(): string {
  const raw = process.env.APP_URL ?? (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:3000');
  if (!raw) throw new Error('Set APP_URL to the public frontend HTTPS origin.');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash ||
    (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new Error('APP_URL must be a public origin without credentials, path, query, or fragment; production requires HTTPS.');
  }
  return url.origin;
}
