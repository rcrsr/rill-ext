# Changelog

## [Unreleased]

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
