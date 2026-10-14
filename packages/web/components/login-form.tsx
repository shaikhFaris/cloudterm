'use client';

import { useRef, useState, type ComponentProps, type FormEvent } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getGithubAuthorizationUrl } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type LoginFormProps = ComponentProps<'div'> & { initialError?: string };

export function LoginForm({ className, initialError, ...props }: LoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(initialError);
  const pending = useRef(false);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setIsLoading(true);
    setError(undefined);

    try {
      const authorizationUrl = await getGithubAuthorizationUrl();
      window.location.assign(authorizationUrl);
    } catch {
      setError('Unable to connect to GitHub sign-in. Please try again.');
      setIsLoading(false);
      pending.current = false;
    }
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Sign in to CloudTerm</CardTitle>
          <CardDescription>Use your GitHub account to access your workspaces.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="flex flex-col gap-4" aria-busy={isLoading}>
            <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
              {isLoading ? (
                <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 16 16" fill="currentColor" className="size-4" aria-hidden="true">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
              )}
              {isLoading ? 'Connecting to GitHub...' : 'Login with GitHub'}
            </Button>
            {error && (
              <p role="alert" className="text-center text-sm text-destructive">
                {error}
              </p>
            )}
            <p className="text-center text-sm text-muted-foreground">
              Your account is created automatically when you first sign in.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
