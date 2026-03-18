# Changelog

## [1.0.0] - 2026-03-18

### Breaking Changes

- `prompt()`, `skill()`, `command()` now return `RillStream` instead of dict.
  Callers must either iterate chunks or resolve via `()` to access the result dict.

  Migration: `claude_code::prompt("task")` => use `claude_code::prompt("task")()` to preserve dict access,
  or `claude_code::prompt("task") each $line { ... }` to stream stdout line chunks.

### Added

- Streaming support: all 3 functions yield stdout line chunks before resolution.
- Each chunk is a string (one stdout line from the Claude CLI process).
