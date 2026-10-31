import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { DataTable } from "@/components/data-table"
import { SectionCards } from "@/components/section-cards"

import data from "./data.json"
import { Suspense } from 'react';
import { requireUser } from '@/lib/server/auth';
import { hasRecentRenewal } from '@/lib/server/auth-redirects';
import { connection } from 'next/server';

type Props = { searchParams: Promise<{ authRenewed?: string | string[] }> };

async function DashboardContent({ searchParams }: Props) {
  await connection();
  const params = await searchParams;
  await requireUser({ returnTo: '/dashboard', allowRefresh: !hasRecentRenewal(params.authRenewed) });

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <SectionCards />
      <div className="px-4 lg:px-6">
        <ChartAreaInteractive />
      </div>
      <DataTable data={data} />
    </div>
  )
}

export default function Page(props: Props) {
  return <Suspense fallback={<p role="status" className="p-6">Loading dashboard…</p>}>
    <DashboardContent {...props} />
  </Suspense>;
}
