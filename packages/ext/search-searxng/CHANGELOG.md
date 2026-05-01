# Changelog

## [0.19.1] - 2026-04-30

### Changed (Breaking)

- Both host-function callables (`search`, `config`) declare concrete `returnType` shapes per `.claude/policies/policy-domain-ext.md` §EXT.8. `search` returns `dict(query: string, number_of_results: number, results: list, suggestions: list, answers: list, infoboxes: list, corrections: list)` (last four optional). `config` returns `dict(categories, engines, plugins, locales)`. Inner vendor objects remain typed as `any` because the extension forwards SearXNG's JSON without reshaping. Scripts introspecting the callable's `returnType` property previously saw `dict`; they now see the precise top-level field set.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.


## [0.18.4] - 2026-04-05

### Changed

- Dependencies updated

## [0.18.2] - 2026-04-04

Initial release. Functions: `search`, `config`.
