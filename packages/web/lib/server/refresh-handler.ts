import { getAuthReturnPath, getRenewedLocation } from './auth-redirects';
import { renewSession, type AuthGatewayOptions } from './auth-client-core';

function redirectResponse(location: string) {
  return new Response(null, { status: 303, headers: {
    Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  } });
}

export async function handleSessionRefresh(request: Request,
  options: AuthGatewayOptions & { appOrigin: string; refreshToken?: string }): Promise<Response> {
  // Renewal is a same-origin POST. A foreign website cannot submit this with our origin.
  const fetchSite = request.headers.get('sec-fetch-site');
  if (request.method !== 'POST' || request.headers.get('origin') !== options.appOrigin ||
    (fetchSite && fetchSite !== 'same-origin')) {
    return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  let returnTo: FormDataEntryValue | null;
  try {
    const form = await request.formData();
    returnTo = form.get('returnTo');
  } catch {
    return new Response('Invalid request', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const cookies = await renewSession(options.refreshToken, options);
    if (!cookies) return redirectResponse('/login?error=session_expired');
    const response = redirectResponse(getRenewedLocation(returnTo));
    for (const cookie of cookies) response.headers.append('Set-Cookie', cookie);
    return response;
  } catch {
    // Do not clear cookies or report a logged-out user when the gateway is unavailable.
    return redirectResponse(`/auth/renew?${new URLSearchParams({
      error: 'unavailable', returnTo: getAuthReturnPath(returnTo),
    })}`);
  }
}
