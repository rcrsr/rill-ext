# Changelog

## [0.19.2] - 2026-05-01

### Changed (Breaking)

- `messages` verb removed. Use `message` with a list prompt for multi-turn conversations.
- `text` parameter renamed to `prompt` on all verbs (`message`, `tool_loop`, `generate`).
- `options` dict removed from `message` and `generate`. Per-call `system` and `max_tokens`
  previously in `options` are now factory-only config (`system`, `max_tokens`).
- `tool_loop` `max_turns` moves from `options.max_turns` to a positional parameter
  (default `0` sentinel — resolves to factory `max_turns` or unlimited).
- Output shape: `content` field removed from all verbs. Replaced by `messages` (parts-shaped
  list of `{ role, parts }` dicts). `tool_calls` legacy flattened list also removed.
- `generate` now includes `messages` in its return dict (full conversation transcript).
- `stop_reason` field added to all verbs (maps from `finish_reason` in Chat Completions).
- Model-class routing at factory init: o-series models (o1, o3, etc.) use Responses API;
  standard models use Chat Completions. Routing is fixed for the extension instance lifetime.
- Factory config adds `max_turns` (positive integer, rejects 0 sentinel and negatives) and
  `max_errors` (integer, default 3). These are declared in `configSchema`.
- `extra` is a `LLMProviderConfig` field validated at factory init via `validateExtraKeys`.
  It is NOT declared in `configSchema` (ConfigFieldDescriptor.type only supports string,
  number, and boolean). Keys in `extra` must not collide with reserved provider keys.
  Validated `extra` fields are spread verbatim into the request body params dict (the first
  argument to OpenAI SDK methods). openai Node SDK v6 removed the `extra_body` request option
  that existed in v4; params-spread is the v6 mechanism for passing extra body fields.

## [0.19.1] - 2026-04-28

### Fixed

- `generate()` JSON Schema now sets `additionalProperties: false` on every emitted object, including untyped `dict` parameters. Previously, untyped `dict` produced bare `{ type: "object" }`, which fails OpenAI strict-mode validation and caused `400 invalid_request_error` on Groq `openai/gpt-oss-120b`. Providers that previously worked are unaffected.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.4] - 2026-04-05

### Changed

- `openai` updated from ^6.25.0 to ^6.33.0

## [0.18.3] - 2026-04-05

### Breaking Changes

- `generate()` schema parameter changed from dict descriptor to rill type expression.
  Pass a type value (e.g. `dict(name: string, age: number)`) instead of `{ schema: { name: "string" } }` in options.

### Added

- `generate()` reads field descriptions from `^("desc")` type annotations.

## [0.18.2] - 2026-04-04

### Fixed

- `tool_loop()` strips SDK-injected properties (`parsed`, `refusal`) from assistant messages
  before sending them in the next API request

### Added

- Docs: OpenAI-compatible provider section covering Groq, Together AI, Fireworks AI

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
