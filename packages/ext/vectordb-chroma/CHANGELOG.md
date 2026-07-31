# Changelog

## [Unreleased]

## [0.20.0] - 2026-07-30

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped from `~0.19.0` to `~0.20.0`. This package now requires rill `0.20.x`; consumers on rill `0.19.x` must stay on `0.19.x` of this package.
- No runtime surface changes. No callable signatures, parameter names, return shapes, or error atoms changed.

## [0.19.1] - 2026-07-11

### Added

- **rill.role declaration:** Declares `"rill": { "role": "extension" }` in `package.json` so the rill-cli install gate admits this package. ([#58](https://github.com/rcrsr/rill-ext/pull/58))

### Changed

- **chromadb 3.5:** Bumps chromadb to ^3.5.0. ([#61](https://github.com/rcrsr/rill-ext/pull/61))

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.4] - 2026-04-05

### Changed

- `chromadb` updated from ^3.3.1 to ^3.4.0

## [0.18.1] - 2026-04-03

### Fixed

- `@rcrsr/rill-ext-param-shared` moved from `dependencies` to `devDependencies`

## [0.18.0] - 2026-04-02

### Changed

- All extension docs rewritten from TypeScript `hoistExtension` API to `rill-config.json`
