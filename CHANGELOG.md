# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- New `@rcrsr/rill-ext-outlook` extension providing access to Microsoft Graph mail and calendar operations including inbox, search, send, draft, reply, flag, events, free-busy, and event creation

## [0.18.4] - 2026-04-05

### Changed

- All vendor SDK dependencies updated to latest versions
- TypeScript upgraded from 5.9.3 to 6.0.2
- `tsconfig.base.json` adds `"types": ["node"]` for TypeScript 6 compatibility
- All 22 `tsconfig.build.json` files refactored to extend `tsconfig.base.json`
- Dev toolchain updated: vitest 4.1.2, eslint 10.2.0, @typescript-eslint 8.58.0

## [0.18.3] - 2026-04-05

### Added

- New `@rcrsr/rill-ext-datetime` extension with timezone conversion, date/time formatting, and parsing via the Intl API
- New `@rcrsr/rill-ext-kv-shared` shared package with `KvExtensionContract` and `SchemaEntry` types
- New `@rcrsr/rill-ext-fs-shared` shared package with `FsExtensionContract` type
- LICENSE files added to 9 extensions that were missing them

### Changed (Breaking)

- `generate()` on all 3 LLM extensions accepts a rill type expression as the schema
  parameter instead of a dict descriptor in options. Field descriptions read from
  `.^description` annotations on `RillFieldDef`.
- `buildJsonSchema` removed from `@rcrsr/rill-ext-llm-shared`; use
  `buildJsonSchemaFromStructuralType` with dict `TypeStructure` instead

### Changed

- KV extensions (`kv-file`, `kv-redis`, `kv-sqlite`) import `KvExtensionContract`
  and `SchemaEntry` from `@rcrsr/rill-ext-kv-shared` instead of `@rcrsr/rill`
- FS extensions (`fs-local`, `fs-s3`) import `FsExtensionContract` from
  `@rcrsr/rill-ext-fs-shared` instead of `@rcrsr/rill`
- All packages resolve `@rcrsr/rill@~0.18.0` to 0.18.3 for `RillFieldDef.annotations`

### Fixed

- CI release workflow catches E403 "already published" errors instead of failing
- `kv-redis` integration test imports `createKvFileExtension` from `@rcrsr/rill-ext-kv-file`
  instead of removed `@rcrsr/rill/ext/kv` subpath

## [0.18.2] - 2026-04-04

### Added

- Five web search extensions with shared validation, disposal, and error mapping via ext-search-shared:
  `rill-ext-search-brave`, `rill-ext-search-exa`, `rill-ext-search-searxng`, `rill-ext-search-serper`, `rill-ext-search-tavily`
- Five standalone extensions using Node.js built-ins (zero external dependencies):
  `rill-ext-crypto`, `rill-ext-exec`, `rill-ext-fetch`, `rill-ext-fs-local`, `rill-ext-kv-file`
- `llms.txt` discovery index for all 21 extensions in this repository
- OpenAI docs: compatible provider section covering Groq, Together AI, Fireworks AI

### Fixed

- `rill-ext-openai` tool loop now strips SDK-injected properties (`parsed`, `refusal`) from
  assistant messages before sending them in the next API request
- `rill-ext-fetch` signal handling: `executeRequest()` combines timeout and external signals
  via `AbortSignal.any()` so dispose cancellation reaches in-flight requests
- `rill-ext-fetch` removed dead config options (`responseFormat`, `body` encoding) that were
  declared in types but never implemented
- `rill-ext-fetch` global `responseShape` config now propagates through `mapEndpointConfig()`
- `rill-ext-fs-local` `mkdir()` uses ancestor realpath resolution to prevent symlink escapes
- `rill-ext-fs-local` `read()` and `remove()` rethrow sandbox violations instead of masking
  them as "file not found" or returning false
- `rill-ext-fs-local` docs updated to reflect actual `RILL-R004` error code (removed phantom
  RILL-R017..R021)
- `rill-ext-exec` `stdin` parameter `defaultValue` changed from `''` to `undefined` to avoid
  false "stdin not allowed" validation
- `rill-ext-crypto` `random()` validates bytes parameter (rejects negative, non-integer, >1MB)

## [0.18.1] - 2026-04-03

### Fixed

- `@rcrsr/rill-ext-param-shared` moved from `dependencies` to `devDependencies` in all 11
  extension packages; the private shared package was bundled by tsup at build time but
  listed as a runtime dependency, causing unresolvable installs from npm
- All 14 packages bumped to v0.18.1

## [0.18.0] - 2026-04-02

### Added

- `buildResponseMessages()` shared helper in ext-llm for consistent response messages
- `tools` promoted to positional argument in `tool_loop()` across all 3 LLM extensions
- MCP: static resource shortcut callables via `generateStaticResourceFunctions()`
- MCP: `jsonSchemaToTypeStructure()` converts outputSchema to rill TypeStructure
- MCP: name sanitizer handles whitespace in MCP identifiers

### Changed

- LLM and Claude Code host functions return RillStream values, supporting iteration
  over output chunks as they arrive while still resolving full results via ()

### Changed (Breaking)

- All 14 packages bumped to v0.18.0 (`peerDependency: ~0.18.0`)
- All extension docs rewritten from TypeScript `hoistExtension` API to `rill-config.json`
- `LlmExtensionContract` moved from `@rcrsr/rill` to ext-llm-shared
- `VectorExtensionContract` moved from `@rcrsr/rill` to ext-vector-shared
- MCP: capabilities restructured as namespace dicts (`tools`, `resources`, `prompts`)
- MCP: `createIntrospectionDicts` replaces `createIntrospectionFunctions`
- MCP: prompt names no longer prefixed with `prompt_`
- fs-s3: path API changed from `(mount, path)` to combined `/mount/path` string
- fs-s3: `parseMountPath()` replaces `getMount()` + `mapPath()` with longest-match routing
- fs-s3: `stat` returns `name`, `type`, `modified` (ISO string) instead of epoch number
- fs-s3: `mounts` returns list of mount detail dicts instead of name list
- fs-s3: `copy`/`move` validate same-mount constraint on src and dest

### Removed

- Test host sections from LLM and Claude Code docs (examples/ no longer shipped)
- Lifecycle sections from vector DB docs (runtime manages dispose)

### Fixed

- Anthropic `tool_loop()` includes the assistant message in response `messages` array
- 0-parameter tools no longer fail with "Function expects 0 arguments, got 1"
- `max_tokens: 0` treated as unset, falls through to factory default
- OpenAI: `stream_options.include_usage` set on all streaming calls for token counting
- MCP: `buildCallableDict` preserves existing annotations instead of overwriting
- MCP: static resource error messages use sanitized callable name, not raw MCP name

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
