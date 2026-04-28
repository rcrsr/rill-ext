# Changelog

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
