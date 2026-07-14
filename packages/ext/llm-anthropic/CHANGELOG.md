# Changelog

## [Unreleased]

## [0.19.3] - 2026-07-11

### Added

- **rill.role declaration:** Declares `"rill": { "role": "extension" }` in `package.json` so the rill-cli install gate admits this package. ([#58](https://github.com/rcrsr/rill-ext/pull/58))

### Changed

- Bumps `@anthropic-ai/sdk` to `^0.111.0` (from `^0.82.0`). In-use API surface unchanged. ([#57](https://github.com/rcrsr/rill-ext/pull/57))

## [0.19.2] - 2026-05-01

### Changed (Breaking)

- `messages` verb removed. Pass a list of message dicts directly to `message(prompt)` for multi-turn calls.
- `text` parameter renamed to `prompt` on all verbs (`message`, `tool_loop`, `generate`). String input still works.
- Options dicts removed from `message`, `tool_loop`, and `generate`. Per-call `system` and `max_tokens` are now factory-only config fields. `max_turns` for `tool_loop` is now a positional `number` parameter (default `0` = no per-call cap).
- All verbs return parts-shaped `messages` list (`[{role, parts:[{type, text, ...}]}]`) instead of `content: string`. The `content` field is removed.
- `tool_loop` result no longer includes `tool_calls` field (subsumed by parts in `messages`).
- Factory accepts `max_turns` (positive integer or undefined), `max_errors` (number), and `extra` (dict) config fields. Zero or negative `max_turns` at factory init throws `RuntimeError('RILL-R001', ...)`. Keys in `extra` must not collide with `RESERVED_KEYS_COMMON`.

## [0.19.1] - 2026-04-28

### Fixed

- Tool `input_schema` now sets `additionalProperties: false` on every emitted object, including untyped `dict` parameters. Inherited from `@rcrsr/rill-ext-llm-shared`. No behavioral change for Anthropic (which does not enforce strict mode), but tool schemas are now stricter and consistent across LLM extensions.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.4] - 2026-04-05

### Changed

- `@anthropic-ai/sdk` updated from ^0.78.0 to ^0.82.0

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
