'use client';

import { Button } from '@/components/ui/button';

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <p role="alert">Unable to load your dashboard. Please try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
