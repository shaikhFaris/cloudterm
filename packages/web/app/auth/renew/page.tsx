import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SessionRenewalForm } from '@/components/session-renewal-form';
import { getAuthReturnPath } from '@/lib/server/auth-redirects';

type Props = { searchParams: Promise<{ returnTo?: string | string[]; error?: string | string[] }> };

async function RenewalContent({ searchParams }: Props) {
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  if (!cookieStore.get('refreshToken')?.value) redirect('/login?error=session_expired');
  return <SessionRenewalForm returnTo={getAuthReturnPath(params.returnTo)} automatic={params.error !== 'unavailable'} />;
}

export default function RenewalPage(props: Props) {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Suspense fallback={<p role="status">Loading your session…</p>}>
        <RenewalContent {...props} />
      </Suspense>
    </main>
  );
}
