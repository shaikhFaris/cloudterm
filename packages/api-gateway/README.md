# API gateway authentication

## GitHub OAuth

Create a GitHub OAuth App and set these environment variables for the gateway:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_CALLBACK_URL`, for example `http://localhost:3001/api/v1/auth/github/callback`

Register the same callback URL in the GitHub OAuth App settings. Credentials stay on the server.
These three variables are required by the gateway's environment validation.

Apply the shared database migration before starting the updated gateway. From
`packages/shared/db`, run `bun x drizzle-kit migrate` after configuring the database
connection in `drizzle.config.ts`. Migration `0005_github_oauth.sql` adds a unique
GitHub ID and allows a null password for OAuth accounts. Existing passwords are preserved.

Navigate the browser to `GET /api/v1/auth/github` to start login. The callback at
`GET /api/v1/auth/github/callback` sets the same access/refresh cookies as password
login and returns `{ "id": "...", "email": "..." }`. Optionally set
`GITHUB_SUCCESS_REDIRECT_URL` to a fixed frontend URL to redirect after success.
No tokens are included in redirect URLs. Use HTTPS in production; existing session
cookies require a secure context and a `COOKIE_DOMAIN` matching the gateway host.

The flow uses a ten-minute HttpOnly state cookie and S256 PKCE. It requests
`user:email` and requires a verified primary email, including private emails.
Returning users are identified by GitHub ID. A matching email on an existing account
returns 409; automatic linking is not supported. OAuth-only accounts cannot use password login.
Errors use the gateway's existing JSON error format. Restart login after a failed callback.

Protocol reference: [GitHub OAuth authorization flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

Run tests from the repository root with `bun test packages/api-gateway/tests`.
OAuth tests mock GitHub and database operations; they need no credentials or live database.

## Security and deployment limitations

Session JWT lifetimes use the configured milliseconds. Tokens issued before the
expiration-unit fix retain their original expiry; rotate the signing secrets when
deploying if those sessions need to be invalidated (this logs everyone out).

The gateway omits query strings from request logs. Configure reverse proxies and
hosting access logs to redact OAuth callback query strings as well.
Register an exact callback URL in GitHub and disable wildcard callback matching.

The state cookie expires and is cleared on callback, but there is no server-side
single-use state store. Starting a second login in the same browser replaces the
first attempt. GitHub's authorization-code validation and PKCE protect code exchange.
Refresh tokens are stored in plaintext and are not rotated on refresh. Logout
removes the stored refresh token; existing access tokens remain valid until expiry,
and protected routes do not check database session revocation. The gateway currently
has no auth rate limiter or explicit CSRF/origin validation for cookie-authenticated
mutations beyond SameSite cookies. These require further production hardening.
