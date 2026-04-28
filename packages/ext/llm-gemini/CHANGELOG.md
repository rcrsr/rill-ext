# Changelog

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.4] - 2026-04-05

### Changed

- `@google/genai` updated from ^1.42.0 to ^1.48.0

## [0.18.3] - 2026-04-05

### Breaking Changes

- `generate()` schema parameter changed from dict descriptor to rill type expression.
  Pass a type value (e.g. `dict(name: string, age: number)`) instead of `{ schema: { name: "string" } }` in options.

### Added

- `generate()` reads field descriptions from `^("desc")` type annotations.

## [0.18.1] - 2026-04-03

### Fixed

- `@rcrsr/rill-ext-param-shared` moved from `dependencies` to `devDependencies`

## [0.18.0] - 2026-04-02

### Breaking Changes

- `message()`, `messages()`, `tool_loop()` now return `RillStream` instead of dict.
  Callers must either iterate chunks or resolve via `()` to access the result dict.

  Migration: `llm::message("hi")` => use `llm::message("hi")()` to preserve dict access,
  or `llm::message("hi") -> each { log }` to stream chunks.

### Added

- Streaming support: `message`, `messages`, and `tool_loop` yield incremental chunks before resolution.
- `message()` and `messages()` yield string text delta chunks.
- `tool_loop()` yields structured event dicts with `type` field: `text_delta`, `tool_call`, `tool_result`.
