'use client';

import { Check, Circle, FlaskConical, LoaderCircle, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLabs } from '@/hooks/use-labs';
import { LabCountdown } from '@/components/lab-countdown';

export function NewLab({ userId }: { userId: string }) {
  const { lab, active, status, mutation, canCreate, start, checkAgain } = useLabs(userId);
  const queued = lab?.status === 'queued';
  const running = lab?.status === 'running';
  const ended = lab?.status === 'deleted';
  const checking = active.isPending || (!!lab && status.isPending);
  const error = active.isError || status.isError || mutation.isError;
  const busy = mutation.isPending || queued;
  const steps = ['Request accepted', 'Preparing your workspace', 'Ready to use'];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6">
      <div>
        <p className="mb-2 text-sm font-medium text-muted-foreground">YOUR WORKSPACE</p>
        <h1 className="text-3xl font-semibold tracking-tight">Start a new lab</h1>
        <p className="mt-2 text-muted-foreground">A fresh cloud workspace for your next hands-on session.</p>
      </div>
      <Card>
        <CardHeader className="gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FlaskConical className="size-6" aria-hidden="true" />
          </div>
          <CardTitle>Cloud lab</CardTitle>
          <CardDescription>One dedicated workspace at a time. You can leave this page and return to check its progress.</CardDescription>
        </CardHeader>
        <CardContent className="gap-6">
          <div role="status" aria-live="polite" aria-atomic="true" className="rounded-lg border bg-muted/30 p-5">
            <div className="flex items-center gap-3">
              {checking || busy ? <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden="true" /> :
                running ? <Check className="size-5 text-emerald-600" aria-hidden="true" /> : <Server className="size-5" aria-hidden="true" />}
              <p className="font-medium">{checking ? 'Checking your workspace…' : mutation.isPending ? 'Requesting your lab…' :
                queued ? 'Preparing your workspace' : running ? 'Your workspace is running' : ended ? 'Your lab has ended' : 'Ready when you are'}</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{queued ? 'Your request is queued. We’ll update this page automatically when your workspace is ready.' :
              running ? 'Your lab is ready. You can start another once this session ends.' :
                ended ? 'This workspace is no longer active. You can start a fresh lab.' : 'Start a lab to create your personal cloud workspace.'}</p>
            {(queued || running) && <ol className="mt-5 space-y-3" aria-label="Lab progress">
              {steps.map((step, index) => <li key={step} className="flex items-center gap-3 text-sm">
                {running || index === 0 ? <Check className="size-4 text-emerald-600" aria-hidden="true" /> :
                  index === 1 ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : <Circle className="size-4 text-muted-foreground" aria-hidden="true" />}
                {step}
              </li>)}
            </ol>}
          </div>
          {running && lab.expiresAt && <LabCountdown key={`${lab.labId}:${lab.expiresAt}`} expiresAt={lab.expiresAt} />}
          {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p>{mutation.isError ? 'We couldn’t confirm your request. Retry safely; this won’t create a second workspace.' :
              'We couldn’t update your lab status. Your workspace may still be running.'}</p>
            <Button variant="outline" size="sm" className="mt-3" disabled={mutation.isPending || active.isFetching || status.isFetching}
              onClick={mutation.isError ? start : () => { void checkAgain(); }}>
              <RefreshCw aria-hidden="true" /> {mutation.isError ? 'Retry request' : 'Check again'}
            </Button>
          </div>}
          <Button size="lg" className="w-full sm:w-auto sm:self-start" disabled={!canCreate || error} onClick={start}>
            {busy ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : <FlaskConical aria-hidden="true" />}
            {mutation.isPending ? 'Requesting lab…' : queued ? 'Lab is starting…' : running ? 'Lab is running' : 'Start new lab'}
          </Button>
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4" aria-hidden="true" />Only one queued or running lab is allowed per account.</p>
        </CardContent>
      </Card>
    </div>
  );
}
