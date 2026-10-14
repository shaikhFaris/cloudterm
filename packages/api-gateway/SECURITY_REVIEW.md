# GitHub authentication security review

Reviewed 2026-10-14. This is a source review with mocked regression tests, not a
penetration test or confirmation of production infrastructure settings. No running
containers were rebuilt or restarted as part of this review.

## Findings fixed in source

- **OAuth cookie injection from sibling subdomains (conditional).** The old name
  allowed an attacker controlling a sibling subdomain to supply a parent-domain
  cookie containing an OAuth state signed for the attacker's own login. The
  production state cookie now uses `__Host-githubOAuth`: Secure, HttpOnly, Path=/,
  and no Domain. Callback handling accepts only this name in production. Browser
  enforcement of this prefix prevents parent-domain/path overrides. Development
  HTTP cookies intentionally have weaker transport guarantees.
- **Login cancellation through unsolicited callbacks.** Previously, the callback
  cleared the state cookie before validating state. A cross-site navigation with
  invalid state could cancel an in-progress login. Clearing now follows successful
  state validation. State and cookie input sizes are bounded before parsing.
- **Weak or reused signing-secret configuration.** Empty secrets are rejected;
  access and refresh signing keys must differ. Production requires at least 32
  bytes per secret. Distinct keys prevent a refresh JWT from being accepted in the
  access-token cookie. Operators must generate random secrets; length alone does
  not establish entropy.
- **Identical sessions created in the same second.** JWTs previously used only
  user ID, issuance time, and expiry, so identical inputs produced identical tokens.
  Tokens now contain a random `jti`. This prevents a new login from reproducing an
  earlier revoked refresh-token value.

## Outstanding findings

| Priority | Finding and consequence | Evidence | Recommended change |
| --- | --- | --- | --- |
| High | Refresh tokens are stored as usable plaintext. A database read leak exposes credentials that can obtain new access tokens until expiry or revocation. Tokens also remain reusable across refreshes. | `auth-repository.ts` stores and compares the raw JWT; `auth-services.ts: refresh` returns only a new access token. | Store a SHA-256 digest of high-entropy refresh tokens; rotate refresh tokens atomically and define replay handling. See [OWASP OAuth guidance](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html). |
| Medium | Logout or a replacement login does not immediately revoke protected API access. Someone holding both old JWTs can continue using them until the access JWT expires. | `authenticate-tokens.ts` verifies signatures and matching user IDs but never checks the active database session. Logout deletes the refresh row only. | Validate active session/revocation state on protected requests, or adopt a documented short-lived-access-token policy. |
| Medium, conditional on deployment | Session cookies use a configurable Domain without a host prefix. Sibling servers under that domain can receive the cookies; compromised siblings can also inject domain cookies. | `utils/cookie.ts` sets `domain: env.COOKIE_DOMAIN` for access/refresh cookies. | For the same-origin Next.js proxy architecture, use host-only `__Host-` session cookies and update all consumers together. Avoid serving untrusted workspace content under a shared authentication domain. |
| Medium, conditional on deployment | Cookie-authenticated mutations have no explicit CSRF/origin validation. SameSite=Lax limits ordinary cross-site POSTs, but does not isolate a malicious same-site sibling origin. | Auth refresh/logout and lab creation accept cookies without an Origin/Referer or CSRF check. | Validate trusted public origins and add a session-bound CSRF strategy where needed. See [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). |
| Medium | OAuth initiation, callback, and refresh endpoints have no rate limiting. Attackers can generate many exchanges, upstream requests, or database reads. | Auth routes contain no rate-limit middleware. | Use shared rate-limit storage and correctly configure trusted proxy/IP handling. |
| Medium | Generic error logging can expose database query parameters, including session tokens, when an auth database operation fails outside the callback's safe handler. | `shared/middlewares/global-error.ts` logs arbitrary `err.message` and `err.stack`; Drizzle query errors can embed SQL and parameters. | Redact sensitive fields at the global logger/error boundary; retain fixed error codes and correlation IDs. |
| Low / defense in depth | OAuth state has no server-side consume-once record. Clearing a browser cookie is not server-side invalidation. | State and the verifier live in a signed, expiring cookie. | Consider an expiring, atomic state store if stronger replay controls are required. GitHub's single-use authorization code and PKCE already limit code replay; this finding alone does not demonstrate an account takeover. |

## Controls already present

- Random 256-bit state and PKCE verifier, S256 challenge, ten-minute expiry,
  timing-safe comparison, and a purpose-specific state signing key/audience.
- Fixed GitHub authorization/token/profile endpoints; outbound redirects are
  rejected and requests have a timeout. OAuth secrets and GitHub tokens stay on
  the server. Callback URLs and frontend redirects are configured, not supplied
  by user query parameters. Production OAuth URLs require HTTPS.
- GitHub identity comes from authenticated `/user`, using its durable ID. Signup
  requires a verified primary email; existing email accounts are not silently
  linked. Unique constraints and conflict handling cover concurrent account creation.
- Session cookies are HttpOnly, Secure in production, and SameSite=Lax. Session
  JWTs restrict algorithms to HS256, check expiry, and require matching user IDs.
- Callback responses are not cached, omit referrers, and redirect only fixed
  error codes. Gateway request logs omit query strings.

## Deployment checks that source code cannot establish

- Rotate and delete the previously exposed GitHub client secret if this has not
  already been done. Keep `.env` out of version control and deployment artifacts.
- Register the exact callback URL and disable unnecessary GitHub callback wildcard
  matching. Configure HTTPS and redact callback codes/cookies at reverse proxies.
- Test production browser behavior and the real GitHub exchange after deploying.
  Database migration `0005_github_oauth.sql` must exist in each target database.
- The current dashboard is sample UI without a session guard. Sensitive data and
  actions must always be authorized by the backend regardless of frontend guards.
