# Changelog

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.


## [0.18.4] - 2026-04-05

### Changed

- Dependencies updated

## [0.18.3] - 2026-04-05

- Add README
- Add UTC to valid zones set
- Reject NaN/Infinity in datetime arguments
- Validate parsed date component ranges
- Gate perf tests behind `RUN_PERF_BENCHMARKS` env var

## [0.18.2] - 2026-04-04

Initial release. Functions: `iso`, `date`, `time`, `offset`, `zones`, `format`, `parse`.
