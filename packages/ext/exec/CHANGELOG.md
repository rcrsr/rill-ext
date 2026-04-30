# Changelog

## [0.19.1] - 2026-04-30

### Changed (Breaking)

- Per-command callables now return `exit_code` (snake_case) instead of `exitCode` in the result dict. Aligns with the rill convention that all dict keys exposed at the host-function boundary use snake_case (see root `CLAUDE.md` §Boundary Key Naming). Host scripts reading `result.exitCode` must update to `result.exit_code`.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.


## [0.18.4] - 2026-04-05

### Changed

- Dependencies updated

## [0.18.2] - 2026-04-04

Initial release. Functions: per-command callables, `commands`.
