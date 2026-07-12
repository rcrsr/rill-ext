# Changelog

## [Unreleased]

## [0.19.1] - 2026-04-30

### Changed (Breaking)

- Configured endpoint callables with `responseShape: 'full'` now declare `returnType` as `dict(status: number, headers: dict(string: string), body: any)` instead of shapeless `dict`, per `.claude/policies/policy-domain-ext.md` §EXT.8. With `responseShape: 'body'`, the return remains `any` because the body shape is determined by the user-configured endpoint (§EXT.8.3 case 3).
- The `endpoints` introspection callable now declares `returnType` as `list(dict(name: string, method: string, path: string, description: string))` instead of shapeless `list`. Scripts introspecting the callable's `returnType` property previously saw bare `list` / `dict`; they now see the precise shape.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.


## [0.18.4] - 2026-04-05

### Changed

- Dependencies updated

## [0.18.2] - 2026-04-04

Initial release. Functions: per-endpoint callables, `endpoints`.
