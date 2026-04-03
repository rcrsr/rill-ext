# Changelog

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
