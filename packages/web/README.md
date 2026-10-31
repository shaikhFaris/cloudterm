This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### GitHub sign-in

The `/login` page offers GitHub sign-in only. It uses Axios through a TanStack Query mutation to request
`/api/v1/auth/github` with `Accept: application/json`, then navigates the browser
to the returned GitHub authorization URL. The gateway sets a temporary HttpOnly
cookie before navigation. The browser returns through Next.js at the public
callback URL, and the gateway sets the session cookies and redirects to `/dashboard`.
Denied or expired authorization returns to `/login` with a friendly error.

Next.js forwards `/api/v1/*` to `API_GATEWAY_URL`, defaulting to
`http://localhost:3500`. Set this server-only variable in `packages/web/.env.local`
when using a different gateway address. No `NEXT_PUBLIC` secrets or token storage
are needed. Restart Next.js after changing rewrite configuration.

Configure the gateway's root `.env` (see the root `.env.example`):

```dotenv
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/auth/github/callback
GITHUB_SUCCESS_REDIRECT_URL=http://localhost:3000/dashboard
GITHUB_FAILURE_REDIRECT_URL=http://localhost:3000/login
COOKIE_DOMAIN=localhost
```

Register that exact callback URL in the GitHub OAuth App settings. Set the app's
client ID and secret in the gateway environment and apply migration
`0005_github_oauth.sql` before signing in. Docker Compose reads credentials from
the root `.env`. Run the gateway on port 3500 and Next.js on port 3000, then visit
`http://localhost:3000/login`. Development cookies support HTTP; production uses
Secure cookies and requires HTTPS. For deployment, replace all public auth URLs
with the frontend's HTTPS origin and set `COOKIE_DOMAIN` to its hostname.

The dashboard pages call the server-only `requireUser()` helper before rendering
their protected content. The helper checks `GET /api/v1/auth/check` directly at the
trusted gateway with only the access/refresh cookies. Responses are not cached;
React's `cache` only deduplicates checks within a server render. The sidebar gets
minimal user information as props. There is no client UI guard or auth context.

Use `getCurrentUser()` from `lib/server/auth.ts` for a nullable server-side check,
or `requireUser({ returnTo: '/dashboard' })` to require a session and redirect.
Call it before sensitive data access in each new protected page or Server Action.
JSON Route Handlers should use `getCurrentUser()` and return 401 when it is null.
A layout check alone does not protect its children. The backend
must still authorize every API request and resource independently.

When access expires but a refresh cookie remains, the helper redirects to
`/auth/renew`. A same-origin POST to `/auth/refresh` renews the session and forwards
the gateway's session Set-Cookie headers before returning to the protected page.
Server Components never write cookies or expose JWTs as props. Allowed return paths
are explicit in `lib/server/auth-redirects.ts`; add new protected paths there.
A short-lived URL timestamp stops repeated renewal if cookies are rejected; it
contains no tokens. A backend outage shows a retry state and is not treated as logout.

Set server-only `APP_URL` to the frontend origin (default `http://localhost:3000`
in development). Production requires an explicit HTTPS `APP_URL`, such as
`https://cloudterm.example`. It validates the Origin of renewal POSTs instead of
trusting Host or forwarded host headers. The public frontend and session cookies
must use the same host. These settings are in `packages/web/.env.example`.

### Authenticated browser requests

`lib/api-client.ts` exports the shared `api` Axios instance. Its base URL is
`/api/v1` and it sends HttpOnly cookies automatically. Do not read JWTs or attach
them as Authorization headers. Use this instance from browser API functions and
call those functions from TanStack Query hooks, following `lib/auth.ts` and
`hooks/use-auth.ts`.

The response interceptor renews a session on a protected request's 401, using
`POST /auth/refresh`, then retries the original request once. Concurrent requests
share one refresh attempt; requests started during refresh wait for it. A late
401 uses a cookie that was already renewed. GitHub/login/signup/refresh endpoints
and requests with `skipAuthRefresh: true` bypass renewal.

If refresh or the retried request returns 401, the provider clears cached user data
and navigates to `/login?error=session_expired`. A 403, network failure, or server
error does not log the user out. TanStack Query does not retry terminal auth errors
or cancellations; transient query failures have at most two additional retries.
Mutation retries are disabled. Successful logout cancels queries, clears the cache,
and returns to login.

This Axios singleton and its shared refresh promise are for browser requests only.
Server Components and Next.js server handlers use the server-only helpers described
above. Never share browser refresh coordination or user caches across server requests. Avoid retrying
mutations unless backend authentication runs before any side effect.

Run auth tests from the repository root:
`bun test tests packages/api-gateway/tests`.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
