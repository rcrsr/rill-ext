# Changelog

## [Unreleased]

## [0.19.3] - 2026-07-11

### Added

- **rill.role declaration:** Declares `"rill": { "role": "extension" }` in `package.json` so the rill-cli install gate admits this package. ([#58](https://github.com/rcrsr/rill-ext/pull/58))

## [0.19.2] - 2026-04-30

### Changed (Breaking)

- Per-command callables (configured via `config.commands`) declare `returnType` as `dict(stdout: string, stderr: string, exit_code: number)` instead of shapeless `dict`, per `.claude/policies/policy-domain-ext.md` §EXT.8. The `commands` introspection callable declares `returnType` as `list(dict(name: string, description: string))` instead of shapeless `list`. Scripts introspecting the callable's `returnType` property previously saw bare `dict` / `list`; they now see the precise shape.

## [0.19.1] - 2026-04-30

### Changed (Breaking)

- Per-command callables now return `exit_code` (snake_case) instead of `exitCode` in the result dict. Aligns with the rill convention that all dict keys exposed at the host-function boundary use snake_case (see root `CLAUDE.md` §Boundary Key Naming). Host scripts reading `result.exitCode` must update to `result.exit_code`.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.


## [0.18.4] - 2026-04-05

### Changed

- Dependencies updated

## [0.18.2] - 2026-04-04

Initial release. Functions: per-command callables, `commands`.
