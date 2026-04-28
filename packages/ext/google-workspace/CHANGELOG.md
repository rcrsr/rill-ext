# Changelog

## [0.19.1] - 2026-04-28

### Added

- `auth.type: "oauth-refresh"` variant accepting `client_id`, `client_secret`, and `refresh_token`. Exchanges the refresh token at the Google OAuth2 token endpoint and caches the access token with TTL = `expires_in - 300` seconds, refreshing transparently on expiry. Resolves the friction documented in `FEATURE-google-workspace-auth-refresh.md` for Desktop OAuth clients and personal Gmail/Drive/Calendar accounts

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.7] - 2026-04-26

Initial release. Functions: 17 callables across Gmail, Google Drive, and Google Calendar. Authentication: bearer token, session, and service account (RS256 JWT). Capability gating per service. Exports `extensionManifest` for `rill-run` mounting. Includes runnable examples under `examples/` (gmail-triage, drive-upload, calendar-scheduling).
