# Changelog

## [0.19.1] - 2026-04-30

### Changed (Breaking)

- The `mounts` introspection callable now declares `returnType` as `list(dict(name: string, mode: string, glob: string))` instead of shapeless `list`, per `.claude/policies/policy-domain-ext.md` §EXT.8. Other callables (`list`, `find`, `stat`) already declared rich shapes; unchanged. Scripts introspecting the callable's `returnType` property previously saw bare `list`; they now see the precise element shape.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.


## [0.18.4] - 2026-04-05

### Changed

- Dependencies updated

## [0.18.3] - 2026-04-05

### Changed

- Import `FsExtensionContract` from `@rcrsr/rill-ext-fs-shared` instead of `@rcrsr/rill`

## [0.18.2] - 2026-04-04

Initial release. Functions: `read`, `write`, `append`, `list`, `find`, `exists`, `remove`, `stat`, `mkdir`, `copy`, `move`, `mounts`.
