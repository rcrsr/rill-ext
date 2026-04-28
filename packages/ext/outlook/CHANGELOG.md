# Changelog

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.5] - 2026-04-17

### Added

- Initial release of `@rcrsr/rill-ext-outlook`
- 12 host functions over Microsoft Graph REST API v1.0
- Mail read: `inbox`, `from`, `search`, `read`
- Mail write: `send`, `draft`, `reply`, `flag`
- Calendar: `events`, `today`, `free_busy`, `create_event`
- Two auth modes: `bearer` (static token) and `session` (per-call from RuntimeContext)
- Capability gating with configurable permission flags
- Folder allowlist enforcement on `inbox`
- Shared mailbox support via `/users/{mailbox}/` endpoints
- Zero vendor SDK dependencies (native `fetch` for all HTTP calls)
