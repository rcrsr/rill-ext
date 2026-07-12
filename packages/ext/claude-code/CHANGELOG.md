# Changelog

## [Unreleased]

### Added

- **rill.role declaration:** Declares `"rill": { "role": "extension" }` in `package.json` so the rill-cli install gate admits this package. ([#58](https://github.com/rcrsr/rill-ext/pull/58))

### Changed

- **which 7.x:** Upgrade which from ^6.0.1 to ^7.0.0 (no source changes; which.sync shape unchanged). ([#60](https://github.com/rcrsr/rill-ext/pull/60))

## [0.19.1] - 2026-04-30

### Changed (Breaking)

- Result dict keys now use snake_case at the rill boundary, aligning with the rule documented in root `CLAUDE.md` §Boundary Key Naming. Renames: `exitCode` → `exit_code`, `tokens.cacheRead` → `tokens.cache_read`, `tokens.cacheWrite5m` → `tokens.cache_write_5m`, `tokens.cacheWrite1h` → `tokens.cache_write_1h`. Error metadata under `meta.raw` also renamed: `binaryPath` → `binary_path`, `timeoutMs` → `timeout_ms`, `exitCode` → `exit_code`, `originalError` → `original_error`. Host scripts reading any of these fields must update.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.


## [0.18.4] - 2026-04-05

### Changed

- Dependencies updated

## [0.18.1] - 2026-04-03

### Fixed

- `@rcrsr/rill-ext-param-shared` moved from `dependencies` to `devDependencies`

## [0.18.0] - 2026-04-02

### Breaking Changes

- `prompt()`, `skill()`, `command()` now return `RillStream` instead of dict.
  Callers must either iterate chunks or resolve via `()` to access the result dict.

  Migration: `claude_code::prompt("task")` => use `claude_code::prompt("task")()` to preserve dict access,
  or `claude_code::prompt("task") -> each { log }` to stream stdout line chunks.

### Added

- Streaming support: all 3 functions yield stdout line chunks before resolution.
- Each chunk is a string (one stdout line from the Claude CLI process).
