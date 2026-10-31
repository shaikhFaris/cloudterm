'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

/** Normal form navigation lets the server set cookies before the protected page renders. */
export function SessionRenewalForm({ returnTo, automatic }: { returnTo: string; automatic: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);
  useEffect(() => {
    if (automatic && !submitted.current && form.current) {
      submitted.current = true;
      form.current.requestSubmit();
    }
  }, [automatic]);

  return (
    <form ref={form} action="/auth/refresh" method="post" className="flex flex-col items-center gap-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      <p role={automatic ? 'status' : 'alert'}>
        {automatic ? 'Renewing your session…' : 'Unable to connect. Please try again.'}
      </p>
      <Button type="submit">{automatic ? 'Continue' : 'Try again'}</Button>
    </form>
  );
}
