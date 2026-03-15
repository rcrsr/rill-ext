# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.16.0] - 2026-03-15

### Changed (Breaking)

- All 14 packages require rill v0.16 (`peerDependency: ~0.16.0`)
- Host function args use named `Record<string, RillValue>` instead of positional `RillValue[]`
- Dict field definitions use `RillFieldDef` instead of `RillType | { type, defaultValue }` union
- `p.dict()` field specs accept `Record<string, RillFieldDef>`
- Shared `ext-llm` closure params use `RillFieldDef` objects instead of `[name, type]` tuples
- Shared `ext-llm` tool loop passes named args dict to runtime/application callables

### Added

- Typed `returnType` declarations on all host functions using `rillTypeToTypeValue()`
- Typed dict fields with defaults on `options` params (`system`, `max_tokens`, `tools`, etc.)
- `LlmExtensionContract` and `KvExtensionContract` type satisfaction checks on factory returns
- `generate()` host function on all 3 LLM extensions for structured output with JSON Schema

### Changed

- All 14 extensions upgraded from rill v0.11 through v0.16 runtime API
- `p.dict()` options params use `{}` default instead of `undefined` for optional dict coercion

## [0.9.0] - 2026-03-06

Initial release as independent repository, extracted from [rcrsr/rill](https://github.com/rcrsr/rill).

### Packages

- `@rcrsr/rill-ext-anthropic` — Anthropic Claude LLM extension
- `@rcrsr/rill-ext-gemini` — Google Gemini LLM extension
- `@rcrsr/rill-ext-openai` — OpenAI LLM extension
- `@rcrsr/rill-ext-mcp` — Model Context Protocol extension
- `@rcrsr/rill-ext-claude-code` — Claude Code subprocess extension
- `@rcrsr/rill-ext-kv-redis` — Redis key-value extension
- `@rcrsr/rill-ext-kv-sqlite` — SQLite key-value extension
- `@rcrsr/rill-ext-fs-s3` — S3 filesystem extension
- `@rcrsr/rill-ext-chroma` — ChromaDB vector database extension
- `@rcrsr/rill-ext-pinecone` — Pinecone vector database extension
- `@rcrsr/rill-ext-qdrant` — Qdrant vector database extension
