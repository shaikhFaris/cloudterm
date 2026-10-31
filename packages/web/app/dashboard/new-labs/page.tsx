import type { Metadata } from 'next';
import { FlaskConical } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  await requireUser({ returnTo: '/dashboard/new-labs', allowRefresh: !hasRecentRenewal(params.authRenewed) });
  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <Card className="w-1/3">
        <CardHeader>
          <FlaskConical className="mb-2 size-6 text-primary" aria-hidden="true" />
          <CardTitle>
            <h2>Start a new lab</h2>
          </CardTitle>
          <CardDescription>
            A dedicated cloud workspace for your next hands-on session.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

export default function NewLabsPage(props: Props) {
  return <Suspense fallback={<p role="status" className="p-6">Loading lab…</p>}>
    <NewLabsContent {...props} />
  </Suspense>;
}
