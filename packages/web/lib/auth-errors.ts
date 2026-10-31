const loginErrors: Record<string, string> = {
  github_denied: 'GitHub authorization was cancelled. Please try again.',
  github_state: 'Your sign-in attempt expired or is invalid. Please try again.',
  github_email: 'Verify your primary email on GitHub before signing in.',
  github_conflict: 'An account with this email already exists and cannot be linked automatically.',
  github_failed: 'GitHub sign-in failed. Please try again.',
  session_expired: 'Your session has expired. Please sign in again.',
};

export function getLoginError(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return Object.hasOwn(loginErrors, code) ? loginErrors[code] : loginErrors.github_failed;
}
