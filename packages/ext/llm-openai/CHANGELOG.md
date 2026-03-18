# Changelog

## [1.0.0] - 2026-03-18

### Breaking Changes

- `message()`, `messages()`, `tool_loop()` now return `RillStream` instead of dict.
  Callers must either iterate chunks or resolve via `()` to access the result dict.

  Migration: `llm::message("hi")` => use `llm::message("hi")()` to preserve dict access,
  or `llm::message("hi") each $chunk { ... }` to stream chunks.

### Added

- Streaming support: `message`, `messages`, and `tool_loop` yield incremental chunks before resolution.
- `message()` and `messages()` yield string text delta chunks.
- `tool_loop()` yields structured event dicts with `type` field: `text_delta`, `tool_call`, `tool_result`.
