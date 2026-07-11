# Changelog

## [Unreleased]

## [0.19.1] - 2026-04-30

### Changed (Breaking)

- `getAll` callable's `returnType` is now the homogeneous-value form `dict(string: any)` instead of shapeless `dict`, per `.claude/policies/policy-domain-ext.md` §EXT.8. Values remain `any` because they are user-stored under caller-defined schemas (§EXT.8.3 case 1). `get` and `get_or` continue to return `any` for the same reason. Scripts introspecting the callable's `returnType` property previously saw bare `dict`; they now see `dict(string: any)`.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.4] - 2026-04-05

### Changed

- `better-sqlite3` updated from ^12.6.2 to ^12.8.0

## [0.18.3] - 2026-04-05

### Changed

- Import `KvExtensionContract` and `SchemaEntry` from `@rcrsr/rill-ext-kv-shared` instead of `@rcrsr/rill`

## [0.18.1] - 2026-04-03

### Fixed

- `@rcrsr/rill-ext-param-shared` moved from `dependencies` to `devDependencies`

## [0.18.0] - 2026-04-02

### Breaking Changes

- Path API changed from `(mount, key)` to combined `/mount/key` string
- `mounts` returns list of mount detail dicts instead of name list
