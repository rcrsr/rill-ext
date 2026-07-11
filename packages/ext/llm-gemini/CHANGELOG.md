# Changelog

## [Unreleased]

## [0.19.2] - 2026-05-01

### Changed (Breaking)

- `messages` verb removed. Use `message` with a list prompt for multi-turn conversations.
- `text` parameter renamed to `prompt` across all verbs (`message`, `tool_loop`, `generate`).
- Per-call `options` dict removed from `message` and `generate`. `system` and `max_tokens` now come from factory config only.
- `tool_loop` options dict replaced by positional `max_turns` param (number, default `0`). `system`, `max_tokens`, `max_errors`, and `max_turns` now come from factory config. Per-call `max_turns` of `0` means "use factory default or unlimited"; negative values are rejected with `INVALID_INPUT / invalid_max_turns`.
- Response shape changed from `{content: string, ...}` to `{messages: [{role, parts}], ...}` (parts-shaped output). The `content` key is removed from all verb return dicts.
- `tool_calls` legacy flattened list removed from `tool_loop` response.
- Factory `max_turns` validation: `0` rejected with RILL-R001 (sentinel reserved); negative rejected with RILL-R001.
- Factory `extra` validation: reserved keys `messages, model, system, temperature, max_tokens, stream, response_format, contents, systemInstruction` rejected with RILL-R001. Validated `extra` merges into `generationConfig` at request time.
- Wire translation: canonical `assistant` role maps to Gemini-native `model` role on the wire; boundary stays `assistant`.
- Wire translation: canonical `system` turns lifted to top-level `systemInstruction` parameter; not included in `contents` array.
- Wire translation: `image` parts with `kind: 'base64'` map to `inlineData`; `kind: 'url'` maps to `fileData`. Per-Part single-field rule enforced (only one of `text`/`inlineData`/`fileData`/`functionCall`/`functionResponse` populated per Part).
- `generate` verb adds `messages` field to response (parts-shaped transcript); removes non-streaming-only guard.
- `configSchema` now declares `max_turns` and `max_errors` fields. The `extra` field is a `LLMProviderConfig` option validated at factory init via `validateExtraKeys` against `RESERVED_KEYS_COMMON ∪ ['contents', 'systemInstruction']`; it is not declared in `configSchema` because dict-typed config fields are not currently supported by the rill core schema descriptor type.
- Return types updated: all verbs now use `MESSAGES_RETURN_TYPE`-compatible shapes; `generate` exposes `data`, `raw`, and `messages`.

## [0.19.1] - 2026-04-28

### Fixed

- Intermediate JSON Schema now sets `additionalProperties: false` on every emitted object. Inherited from `@rcrsr/rill-ext-llm-shared`. No observable change: `toGeminiSchema` does not read `additionalProperties` when converting to the Gemini `Schema` type.

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
