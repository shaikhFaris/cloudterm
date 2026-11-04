'use client';

import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { formatLabTime, remainingLabSeconds } from '@/lib/lab-timer';

export function LabCountdown({ expiresAt }: { expiresAt: string }) {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    // Read the clock after hydration; always derive from the deadline so delayed
    // ticks, background tabs, and reloads cannot restart the countdown.
    const update = () => setSeconds(remainingLabSeconds(expiresAt, Date.now()));
    update();
    const interval = window.setInterval(update, 1_000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [expiresAt]);

  const expired = seconds === 0;
  return (
    <div className="mt-5 rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="size-4" aria-hidden="true" />Time remaining</p>
        <span role="timer" aria-label="Lab time remaining" aria-live="off"
          className={`font-mono text-2xl font-semibold tabular-nums ${seconds !== null && seconds <= 10 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
          {seconds === null ? '—:—' : formatLabTime(seconds)}
        </span>
      </div>
      {expired && <p role="status" className="mt-2 text-sm text-muted-foreground">Time is up. Waiting for the server to confirm the lab has ended.</p>}
    </div>
  );
}
