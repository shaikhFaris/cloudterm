# API gateway

## Labs

All lab endpoints require the existing access and refresh cookies and return
`Cache-Control: no-store`.

- `POST /api/v1/labs/create` requires an empty JSON object and an `Idempotency-Key`
  header containing a UUID. It returns HTTP 202 for a queued workspace or 200 for
  an existing running/deleted workspace, with
  `{ "labId": "<workspace UUID>", "jobId": "<workspace UUID>", "status": "queued" }`.
- `GET /api/v1/labs/active` returns the user's queued/running lab as
  `{ "labId": "<workspace UUID>", "status": "queued" }`, or JSON `null`.
- `GET /api/v1/labs/:labId/status` returns HTTP 200 and
  `{ "labId": "<workspace UUID>", "status": "queued" }` with `Cache-Control: no-store`.

Poll using `labId`, not `jobId`. The status endpoint reads PostgreSQL, scoped to
the authenticated user's workspace. Its status is `queued`, `running`, or `deleted`.
The Kubernetes manager persists lifecycle changes; the status request does not query
Kubernetes or BullMQ. A malformed UUID returns 400. Missing labs and labs belonging
to another user both return 404. Database failures propagate as server errors.

Redis stores each user/key-to-lab mapping for 30 seconds. During that window,
retrying the same key returns the same lab. After expiry, a request can create a
fresh lab once the previous lab is deleted. A fresh intentional creation in the
frontend uses a new key. Keys are scoped to users, validated, and normalized to lowercase.
The TTL starts when the mapping is stored, independently of pod startup or deletion;
the database's active-lab check continues to enforce one lab after Redis expiry.
Redis errors fail creation closed with 503. The frontend preserves its key across
network errors and authentication retries.

Creation locks the user's database row before checking for an active lab. Even
different keys, concurrent tabs, and expired Redis records cannot bypass the
one-queued-or-running-lab limit through this endpoint. Existing active labs are
returned rather than rejected. No schema migration is needed; other future
workspace writers must use the same owner lock. This does not repair duplicate
active rows created before this change.

The database transaction commits before enqueueing, and the workspace UUID is
the BullMQ job ID. The manager periodically dispatches committed queued rows,
recovering API crashes or Redis enqueue outages without creating another row.
If enqueueing fails, creation returns 503 while preserving queued intent; the
same key is safe to retry. Running/deleted labs are never re-enqueued by creation.

The new-lab page restores active labs after reload, polls a queued lab every two
seconds and a running lab every five seconds, and stops that lab's polling once
deleted. An active-lab check every five seconds discovers creations in other tabs.
Polling pauses in the background and stops when the component unmounts. A pending
request or active lab disables the start button; backend authorization and locking
remain authoritative.

## Terminal Socket.IO authorization

The gateway's Socket.IO endpoint accepts browser connections only from
`FRONTEND_ORIGIN` (an exact frontend origin). If unset, it uses the origin of
`GITHUB_SUCCESS_REDIRECT_URL`, or `http://localhost:3000` in development.
Production requires a configured HTTPS origin. The browser connects using
`withCredentials: true` and `auth: { labId }`; JWTs stay in HttpOnly cookies.
Use a Socket.IO-aware reverse proxy or the gateway URL for this connection.

Connection middleware verifies both JWTs, checks the active database session,
then validates the lab UUID, authenticated ownership, running state, and expiry.
It emits `terminal:authorized` with `{ labId, expiresAt }` only after authorization.
The socket is bound to that lab. It cannot select another workspace through input.
Lab creation retains its database owner lock and one-active-lab rule; multiple
tabs can connect to the same lab and never create another workspace.

Handshake failures use `connect_error` with `data.code`: `AUTH_REQUIRED`,
`INVALID_LAB_ID`, `LAB_NOT_FOUND`, `LAB_NOT_READY`, `LAB_EXPIRED`, or
`SERVICE_UNAVAILABLE`. The client may refresh over HTTP once for `AUTH_REQUIRED`
and reconnect explicitly; Socket.IO does not run Axios interceptors.

Established sockets close at session/lab expiry and on logout in this gateway.
Database session and lab checks run every five seconds to detect remote logout
or early deletion; database errors close the connection. Reconnects always repeat
authorization. Disconnect cleanup removes timers, session listeners, and credentials.

Terminal exec and manager forwarding remain scaffolds. Input/resize requests
receive `terminal:error` with `TERMINAL_NOT_IMPLEMENTED`, and raw input is not logged.

## GitHub OAuth setup

Create a GitHub OAuth App and set these environment variables for the gateway:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_CALLBACK_URL`, for example `http://localhost:3000/api/v1/auth/github/callback`

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
Requests with `Accept: application/json` receive `{ "authorizationUrl": "..." }`
and the same temporary OAuth cookie, allowing the frontend to start login with fetch.
Set `GITHUB_FAILURE_REDIRECT_URL` to the frontend login URL to return expected
callback errors as an allowlisted error code. Without it, errors use the JSON handler.
No tokens are included in redirect URLs. Development cookies allow HTTP; production
requires HTTPS. `COOKIE_DOMAIN` must match the browser's public hostname, including
the frontend hostname when using the Next.js API rewrite.

The flow uses a ten-minute HttpOnly state cookie and S256 PKCE. It requests
`user:email` and requires a verified primary email, including private emails.
Returning users are identified by GitHub ID. A matching email on an existing account
returns 409; automatic linking is not supported. OAuth-only accounts cannot use password login.
Errors use the gateway's existing JSON error format. Restart login after a failed callback.

Protocol reference: [GitHub OAuth authorization flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

Run tests from the repository root with `bun test packages/api-gateway/tests`.
OAuth tests mock GitHub and database operations; they need no credentials or live database.

## Security and deployment limitations

`GET /api/v1/auth/check` returns `{ "id": "...", "email": "..." }` with
`Cache-Control: no-store`. It requires valid JWTs plus a refresh record matching
the user and presented token, including for passwordless GitHub users. An inactive
session returns 401. The web client can call `POST /api/v1/auth/refresh` and retry
an expired-access request once. Other protected endpoints must still validate
authentication independently; the frontend check is not an authorization boundary.

Session JWT lifetimes use the configured milliseconds. Tokens issued before the
expiration-unit fix retain their original expiry; rotate the signing secrets when
deploying if those sessions need to be invalidated (this logs everyone out).
Access and refresh signing secrets must differ and cannot be empty. Production
requires each to contain at least 32 bytes; generate random secrets, since length
validation cannot measure entropy. New JWTs include a random `jti` so repeated
sign-ins in the same second cannot reuse an identical token.

Production OAuth state uses `__Host-githubOAuth` with Secure, HttpOnly, Path=/, and
no Domain attribute. Development uses `githubOAuth` on the auth path to support
local HTTP. Invalid callbacks do not clear the pending state cookie. When updating
an existing production deployment, restart any in-progress OAuth attempts.

The gateway omits query strings from request logs. Configure reverse proxies and
hosting access logs to redact OAuth callback query strings as well.
Register an exact callback URL in GitHub and disable wildcard callback matching.

The state cookie expires and is cleared after a valid state check, but there is no server-side
single-use state store. Starting a second login in the same browser replaces the
first attempt. GitHub's authorization-code validation and PKCE protect code exchange.
Refresh tokens are stored in plaintext and are not rotated on refresh. Logout
removes the stored refresh token; existing access tokens remain valid until expiry,
and protected routes do not check database session revocation. The gateway currently
has no auth rate limiter or explicit CSRF/origin validation for cookie-authenticated
mutations beyond SameSite cookies. These require further production hardening.

See [the security review](SECURITY_REVIEW.md) for remaining findings and priorities.
