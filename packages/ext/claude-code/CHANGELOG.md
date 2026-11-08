# Changelog

## [Unreleased]

### Changed

- **Test suite trust:** Test files are now type-checked and two assertion-free tests were removed. No runtime change. ([#147](https://github.com/rcrsr/rill-ext/pull/147))
- **Test suite cleanup:** Removes redundant and self-evident tests, parametrizes copy-paste cases, and tightens weak or misnamed assertions. ([#150](https://github.com/rcrsr/rill-ext/pull/150))
- **Type-aware lint cleanup:** Fixes type-aware lint findings in source. No API or behavior change. ([#154](https://github.com/rcrsr/rill-ext/pull/154))

### Fixed

- **Post-dispose calls:** Calls after `dispose()` or factory signal abort throw `#DISPOSED` instead of spawning a process. ([#152](https://github.com/rcrsr/rill-ext/pull/152))
- **In-flight dispose:** A call cancelled by `dispose()` now settles and throws `#DISPOSED` (`extension_disposed`) instead of hanging; a `ctx.signal` abort returns `#TIMEOUT` (`request_cancelled`). ([#153](https://github.com/rcrsr/rill-ext/pull/153))

## [0.23.0] - 2026-11-06

### Changed

- **rill 0.23 migration:** `@rcrsr/rill` peer and dev ranges move from `~0.21.0` to `~0.23.0`. Extensions at `0.23.x` require rill `0.23.x`; consumers on rill `0.21.x` must stay on extensions `0.21.x`. ([#145](https://github.com/rcrsr/rill-ext/pull/145))

## [0.21.0] - 2026-09-09

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped from `~0.20.0` to `~0.21.0`. This package now requires rill `0.21.x`; consumers on rill `0.20.x` must stay on `0.20.x` of this package. ([#123](https://github.com/rcrsr/rill-ext/pull/123))
- No runtime surface changes. No callable signatures, parameter names, return shapes, or error atoms changed.

## [0.20.0] - 2026-07-30

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped from `~0.19.0` to `~0.20.0`. This package now requires rill `0.20.x`; consumers on rill `0.19.x` must stay on `0.19.x` of this package.
- No runtime surface changes. No callable signatures, parameter names, return shapes, or error atoms changed.

## [0.19.2] - 2026-07-11

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
