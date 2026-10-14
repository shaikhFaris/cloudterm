const loginErrors: Record<string, string> = {
  github_denied: 'GitHub authorization was cancelled. Please try again.',
  github_state: 'Your sign-in attempt expired or is invalid. Please try again.',
  github_email: 'Verify your primary email on GitHub before signing in.',
  github_conflict: 'An account with this email already exists and cannot be linked automatically.',
  github_failed: 'GitHub sign-in failed. Please try again.',
};

export function getLoginError(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return Object.hasOwn(loginErrors, code) ? loginErrors[code] : loginErrors.github_failed;
}

export async function getGithubAuthorizationUrl(): Promise<string> {
  const response = await fetch('/api/v1/auth/github', {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error('GitHub sign-in is temporarily unavailable. Please try again.');
  }

  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('authorizationUrl' in data) ||
    typeof data.authorizationUrl !== 'string') {
    throw new Error('Unable to start GitHub sign-in. Please try again.');
  }
  const url = new URL(data.authorizationUrl);
  if (url.origin !== 'https://github.com' || url.pathname !== '/login/oauth/authorize' ||
    url.username || url.password) {
    throw new Error('Unable to start GitHub sign-in. Please try again.');
  }
  return url.toString();
}
