# Changelog

## [Unreleased]

## [0.21.0] - 2026-09-09

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped from `~0.20.0` to `~0.21.0`. This package now requires rill `0.21.x`; consumers on rill `0.20.x` must stay on `0.20.x` of this package. ([#123](https://github.com/rcrsr/rill-ext/pull/123))
- The peer bump itself changes no runtime surface. Behavior changes in this release are listed under Fixed and Security below.

### Changed

- `openai` 6→7. In-use API surface unchanged. ([#103](https://github.com/rcrsr/rill-ext/pull/103))
- Bumps `openai` to `^7.10.0` (from `^7.5.0`). In-use API surface unchanged. ([#123](https://github.com/rcrsr/rill-ext/pull/123))

### Fixed

- `meta.provider` is lowercase on every error path; human-readable messages keep the original casing. ([#99](https://github.com/rcrsr/rill-ext/issues/99), [#102](https://github.com/rcrsr/rill-ext/pull/102))
- Calls after `dispose()` return `#DISPOSED`, and `dispose()` aborts in-flight requests through the factory's AbortControllers, which it previously never used. ([#100](https://github.com/rcrsr/rill-ext/issues/100), [#102](https://github.com/rcrsr/rill-ext/pull/102))
- Shared `mapProviderError` returns a `RuntimeHaltSignal`'s existing value instead of remapping it to `#TIMEOUT`. ([#94](https://github.com/rcrsr/rill-ext/issues/94), [#102](https://github.com/rcrsr/rill-ext/pull/102))
- `tool_loop` preserves `RuntimeHaltSignal` atoms; `chunks()` rethrows them instead of mapping to `#TIMEOUT`. ([#94](https://github.com/rcrsr/rill-ext/issues/94), [#102](https://github.com/rcrsr/rill-ext/pull/102))
- `search` takes `query_type`; grounding returns `start_index`/`end_index`; safety returns `attack_type` (were camelCase). ([#97](https://github.com/rcrsr/rill-ext/issues/97), [#102](https://github.com/rcrsr/rill-ext/pull/102))

## [0.20.0] - 2026-07-30

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped from `~0.19.0` to `~0.20.0`. This package now requires rill `0.20.x`; consumers on rill `0.19.x` must stay on `0.19.x` of this package.
- No runtime surface changes. No callable signatures, parameter names, return shapes, or error atoms changed.

## [0.19.3] - 2026-07-11

### Added

- **rill.role declaration:** Declares `"rill": { "role": "extension" }` in `package.json` so the rill-cli install gate admits this package. ([#58](https://github.com/rcrsr/rill-ext/pull/58))

### Changed

- **openai 6.46:** Bumps openai to ^6.46.0. ([#61](https://github.com/rcrsr/rill-ext/pull/61))

## [0.19.2] - 2026-05-02

### Changed (Breaking)

- `message()` and `generate()` accept the unified `prompt` parameter (string or message-list with `role` plus `content`/`parts`), normalized through the shared `normalizePrompt` helper. Boundary validation rejects empty prompts, trailing assistant turns, invalid roles, and unsupported part types via `#INVALID_INPUT` with `meta.raw.kind`.
- `messages()` host function removed. Multi-turn conversations go through `message(prompt: list)` instead.
- Resolved `message()` value now includes a parts-shaped `messages` field built via `buildResponseMessages`. The top-level `content` field and per-call `options` dict (`system`, `max_tokens`) are retained; foundry does not yet consume `max_turns`, `max_errors`, or `extra` factory config.

## [0.19.1] - 2026-04-28

### Fixed

- `generate()` JSON Schema now sets `additionalProperties: false` on every emitted object, including untyped `dict` parameters. Foundry inherits the fix from `@rcrsr/rill-ext-llm-shared`. Required for OpenAI strict-mode-compliant providers reached through the OpenAI-compatible endpoint.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.5] - 2026-04-17

### Added

- Initial release of `@rcrsr/rill-ext-foundry`
- LLM inference via `AzureOpenAI` SDK: `message`, `messages`, `tool_loop`, `generate`
- Vector embeddings: `embed`, `embed_batch`
- Azure AI Content Safety prompt shielding: `shield`, `autoShield`
- Bing grounding with citations: `ground`
- Azure AI Search integration: `search`
- Token usage tracking: `usage`
- Two auth modes: `api-key` and `entra` (Entra ID / Azure AD)
- Structured event emission for all operations
