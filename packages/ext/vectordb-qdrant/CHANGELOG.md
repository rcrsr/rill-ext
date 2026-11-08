# Changelog

## [Unreleased]

### Changed

- **Test suite trust:** Tests are type-checked; dispose-during-upsert_batch asserts the settled result and #DISPOSED. No runtime change. ([#147](https://github.com/rcrsr/rill-ext/pull/147))
- **Test suite cleanup:** Removes redundant and self-evident tests, parametrizes copy-paste cases, tightens weak or misnamed assertions, and drops unused batch, distance and wrapper helpers from the bundled shared vector code. ([#150](https://github.com/rcrsr/rill-ext/pull/150))
- **Type-aware lint cleanup:** Fixes type-aware lint findings in source. No API or behavior change. ([#154](https://github.com/rcrsr/rill-ext/pull/154))

### Fixed

- **Post-dispose calls throw:** Calls after `dispose()` throw `#DISPOSED` with `raw.kind` `extension_disposed` instead of returning a disposed value. ([#152](https://github.com/rcrsr/rill-ext/pull/152))

## [0.23.0] - 2026-11-06

### Changed

- **rill 0.23 migration:** `@rcrsr/rill` peer and dev ranges move from `~0.21.0` to `~0.23.0`. Extensions at `0.23.x` require rill `0.23.x`; consumers on rill `0.21.x` must stay on extensions `0.21.x`. ([#145](https://github.com/rcrsr/rill-ext/pull/145))
- Bumps `@qdrant/js-client-rest` to `^1.20.0` (from `^1.19.0`). In-use API surface unchanged. ([#145](https://github.com/rcrsr/rill-ext/pull/145))

## [0.21.0] - 2026-09-09

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped from `~0.20.0` to `~0.21.0`. This package now requires rill `0.21.x`; consumers on rill `0.20.x` must stay on `0.20.x` of this package. ([#123](https://github.com/rcrsr/rill-ext/pull/123))
- The peer bump itself changes no runtime surface. Behavior changes in this release are listed under Fixed and Security below.

### Changed

- `@qdrant/js-client-rest` 1.19 removed `client.search(vector)`; the extension now calls `client.query({ query: vector })`. Results unchanged. ([#103](https://github.com/rcrsr/rill-ext/pull/103))

### Fixed

- `get` on a missing id returns `#NOT_FOUND` (was `#UNAVAILABLE`). ([#96](https://github.com/rcrsr/rill-ext/issues/96), [#102](https://github.com/rcrsr/rill-ext/pull/102))
- Factory config validation errors are `RuntimeError('RILL-R001')`. ([#98](https://github.com/rcrsr/rill-ext/issues/98), [#102](https://github.com/rcrsr/rill-ext/pull/102))

## [0.20.0] - 2026-07-30

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped from `~0.19.0` to `~0.20.0`. This package now requires rill `0.20.x`; consumers on rill `0.19.x` must stay on `0.19.x` of this package.
- No runtime surface changes. No callable signatures, parameter names, return shapes, or error atoms changed.

## [0.19.2] - 2026-07-11

### Added

- **rill.role declaration:** Declares `"rill": { "role": "extension" }` in `package.json` so the rill-cli install gate admits this package. ([#58](https://github.com/rcrsr/rill-ext/pull/58))

### Changed

- **@qdrant/js-client-rest 1.18:** Bumps @qdrant/js-client-rest to ^1.18.0. ([#61](https://github.com/rcrsr/rill-ext/pull/61))

## [0.19.1] - 2026-04-30

### Fixed

- `QdrantClient` is now constructed with `checkCompatibility: false`, suppressing the auto-issued GET that fetches the server version on client construction. The check is best-effort (the SDK proceeds either way), and the unawaited rejection it produces when the server is unreachable could leak past vitest's worker teardown and surface as `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`. The flake caused release CI for `v0.19.4` to fail at the test step (run 25201596964) even though all 75 tests passed; PR CI passed minutes earlier on the same commit because the rejection happened to resolve before teardown. Real version mismatches still surface at the first API call.

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

### Changed

- All extension docs rewritten from TypeScript `hoistExtension` API to `rill-config.json`
