# Changelog

## [Unreleased]

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
