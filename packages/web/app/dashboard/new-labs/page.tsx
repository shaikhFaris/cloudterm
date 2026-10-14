import type { Metadata } from 'next';
import { FlaskConical } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { dashboardRoutes } from '@/lib/dashboard-routes';

export const metadata: Metadata = {
  title: `${dashboardRoutes.newLabs.title} | CloudTerm`,
};

export default function NewLabsPage() {
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
