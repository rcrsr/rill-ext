# Changelog

## [Unreleased]

### Added

- **rill.role declaration:** Declares `"rill": { "role": "extension" }` in `package.json` so the rill-cli install gate admits this package. ([#58](https://github.com/rcrsr/rill-ext/pull/58))

## [0.19.1] - 2026-04-30

### Changed (Breaking)

- All 3 host-function callables (`search`, `news`, `summarize`) declare concrete `returnType` shapes per `.claude/policies/policy-domain-ext.md` §EXT.8. `search` returns `dict(query, web)`, `news` returns `dict(results: list)`, `summarize` returns `dict(summary, title, followups: list, context: list)`. Inner vendor objects (Brave's `query` / `web` / individual result entries) remain typed as `any` because the extension forwards the JSON without reshaping. Scripts introspecting the callable's `returnType` property previously saw `dict`; they now see the precise top-level field set.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.


## [0.18.4] - 2026-04-05

### Changed

- Dependencies updated

## [0.18.2] - 2026-04-04

Initial release. Functions: `search`, `news`, `summarize`.
