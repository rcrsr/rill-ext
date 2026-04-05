# Changelog

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
