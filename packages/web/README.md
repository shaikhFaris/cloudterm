This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### GitHub sign-in

The `/login` page offers GitHub sign-in only. It uses native `fetch` to request
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

The dashboard currently contains sample UI and has no session guard. Backend
authorization remains responsible for protecting authenticated API resources.

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
