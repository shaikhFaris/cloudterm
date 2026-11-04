import type { Metadata } from 'next';
import { NewLab } from '@/components/new-lab';
import { dashboardRoutes } from '@/lib/dashboard-routes';
import { Suspense } from 'react';
import { requireUser } from '@/lib/server/auth';
import { hasRecentRenewal } from '@/lib/server/auth-redirects';
import { connection } from 'next/server';

export const metadata: Metadata = {
  title: `${dashboardRoutes.newLabs.title} | CloudTerm`,
};

type Props = { searchParams: Promise<{ authRenewed?: string | string[] }> };

async function NewLabsContent({ searchParams }: Props) {
  await connection();
  const params = await searchParams;
  const user = await requireUser({ returnTo: '/dashboard/new-labs', allowRefresh: !hasRecentRenewal(params.authRenewed) });
  return <NewLab userId={user.id} />;
}

export default function NewLabsPage(props: Props) {
  return <Suspense fallback={<p role="status" className="p-6">Loading lab…</p>}>
    <NewLabsContent {...props} />
  </Suspense>;
}
