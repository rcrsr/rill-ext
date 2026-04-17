# Changelog

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
