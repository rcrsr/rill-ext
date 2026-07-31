# Changelog

## [Unreleased]

## [0.20.0] - 2026-07-30

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped from `~0.19.0` to `~0.20.0`. This package now requires rill `0.20.x`; consumers on rill `0.19.x` must stay on `0.19.x` of this package.
- No runtime surface changes. No callable signatures, parameter names, return shapes, or error atoms changed.

## [0.19.2] - 2026-07-11

### Added

- **rill.role declaration:** Declares `"rill": { "role": "extension" }` in `package.json` so the rill-cli install gate admits this package. ([#58](https://github.com/rcrsr/rill-ext/pull/58))

### Changed

- **ioredis 5.11.1:** Bumps ioredis to ^5.11.1. ([#61](https://github.com/rcrsr/rill-ext/pull/61))

## [0.19.1] - 2026-04-30

### Changed (Breaking)

- `getAll` callable's `returnType` is now the homogeneous-value form `dict(string: any)` instead of shapeless `dict`, per `.claude/policies/policy-domain-ext.md` §EXT.8. Values remain `any` because they are user-stored under caller-defined schemas (§EXT.8.3 case 1). `get` and `get_or` continue to return `any` for the same reason. `schema` and `mounts` already declare rich `list(dict(...))` shapes; unchanged. Scripts introspecting the callable's `returnType` property previously saw bare `dict`; they now see `dict(string: any)`.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.4] - 2026-04-05

### Changed

- `ioredis` updated from ^5.9.3 to ^5.10.1

## [0.18.3] - 2026-04-05

### Changed

- Import `KvExtensionContract` and `SchemaEntry` from `@rcrsr/rill-ext-kv-shared` instead of `@rcrsr/rill`

### Fixed

- Integration test import of `createKvFileExtension` from removed `@rcrsr/rill/ext/kv` subpath

## [0.18.1] - 2026-04-03

### Fixed

- `@rcrsr/rill-ext-param-shared` moved from `dependencies` to `devDependencies`

## [0.18.0] - 2026-04-02

### Breaking Changes

- Path API changed from `(mount, key)` to combined `/mount/key` string
- `mounts` returns list of mount detail dicts instead of name list
