import { cookies } from 'next/headers';
import { getAppOrigin, getAuthGatewayUrl } from '@/lib/server/auth-config';
import { handleSessionRefresh } from '@/lib/server/refresh-handler';

export async function POST(request: Request): Promise<Response> {
  const cookieStore = await cookies();
  return handleSessionRefresh(request, {
    appOrigin: getAppOrigin(),
    gatewayUrl: getAuthGatewayUrl(),
    refreshToken: cookieStore.get('refreshToken')?.value,
  });
}
