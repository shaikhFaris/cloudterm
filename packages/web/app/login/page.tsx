import { Suspense } from 'react';
import Link from 'next/link';
import { GalleryVerticalEndIcon } from 'lucide-react';
import { LoginForm } from '@/components/login-form';
import { getLoginError } from '@/lib/auth-errors';

type LoginPageProps = {
  searchParams: Promise<{ error?: string | string[] }>;
};

async function LoginContent({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  return <LoginForm initialError={getLoginError(typeof error === 'string' ? error : undefined)} />;
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Link href="/" className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <GalleryVerticalEndIcon className="size-4" aria-hidden="true" />
          </div>
          CloudTerm
        </Link>
        <Suspense fallback={<LoginForm />}>
          <LoginContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
