# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.19.3] - 2026-04-30

### Changed (Breaking)

- Snake_case migration at the rill host-function boundary across 4 extensions. Authoritative rule added to root `CLAUDE.md` §Boundary Key Naming: param names declared via `p.*`, keys read from `args`, keys in returned dict literals, and field names in `returnType` / `retType` declarations MUST be snake_case. Vendor SDK shapes and JS-side internals stay camelCase; map at the boundary.
  - `@rcrsr/rill-ext-google-workspace` bumped to `0.19.2`. Param renames: `messageId`→`message_id`, `fileId`→`file_id`, `folderId`→`folder_id`, `labelName`→`label_name`, `startDate`→`start_date`, `endDate`→`end_date`, `startTime`→`start_time`, `endTime`→`end_time`. Options keys: `maxResults`, `mimeType`, `calendarId`, `allDay`, `sendUpdates` → snake_case. Return keys: `threadId`, `mimeType`, `displayName`, `emailAddress`, `createdTime`, `modifiedTime`, `responseStatus` → snake_case.
  - `@rcrsr/rill-ext-outlook` bumped to `0.19.1`. Param: `messageId`→`message_id`. Event payload keys: `messageCount`, `messageId`, `eventCount`, `resultCount` → snake_case.
  - `@rcrsr/rill-ext-claude-code` bumped to `0.19.1`. Result dict: `exitCode`→`exit_code`, `tokens.cacheRead`/`cacheWrite5m`/`cacheWrite1h` → `cache_read`/`cache_write_5m`/`cache_write_1h`. Error `meta.raw` keys: `binaryPath`, `timeoutMs`, `exitCode`, `originalError` → snake_case.
  - `@rcrsr/rill-ext-exec` bumped to `0.19.1`. Result dict: `exitCode`→`exit_code`.

### Fixed

- `@rcrsr/rill-ext-prompt-md` bumped to `0.19.1`. The dist now bundles `yaml` inline and injects a `createRequire(import.meta.url)` banner so the extension loads as pure ESM. Downstream re-bundlers (e.g., `rill-build`) previously inlined yaml's CJS source verbatim, producing dynamic `require("process")` calls that broke compiled extension bundles with `ExtensionLoadError: Dynamic require of "process" is not supported`. Source-mode runs were unaffected.

## [0.19.2] - 2026-04-28

### Fixed

- `@rcrsr/rill-ext-llm-shared` `buildJsonSchemaFromStructuralType` now sets `additionalProperties: false` on every emitted object, including untyped `dict` parameters and the `vector`/`shape` kinds that map to `"object"`. Previously, those branches produced bare `{ type: "object" }`, which fails OpenAI strict-mode validation and caused `400 invalid_request_error` on Groq `openai/gpt-oss-120b` and any other provider that enforces strict mode. The fix ships in all four consumers — `@rcrsr/rill-ext-openai`, `@rcrsr/rill-ext-foundry`, `@rcrsr/rill-ext-anthropic`, `@rcrsr/rill-ext-gemini` — each bumped to `0.19.1`. All providers that previously worked continue to work.

## [0.19.1] - 2026-04-28

### Added

- `@rcrsr/rill-ext-google-workspace` adds `auth.type: "oauth-refresh"` variant accepting `client_id`, `client_secret`, and `refresh_token`. The extension exchanges the refresh token for an access token and caches it with the same TTL pattern as `service-account` (cache miss/hit/expiry). Documented in `packages/ext/google-workspace/docs/auth.md` with `gws auth export` and OAuth 2.0 Playground setup steps

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- All 26 extensions migrated to `@rcrsr/rill@~0.19.0`. Both `peerDependencies` and `devDependencies` ranges bump from `~0.18.x` to `~0.19.0`.
- Error model overhaul. Rill core retired the fixed `RILL-R004` errorId. Extensions now emit invalid `RillValue`s via `ctx.invalidate(error, meta)` carrying rill core's pre-registered generic atoms: `#AUTH`, `#FORBIDDEN`, `#NOT_FOUND`, `#RATE_LIMIT`, `#QUOTA_EXCEEDED`, `#UNAVAILABLE`, `#CONFLICT`, `#PROTOCOL`, `#INVALID_INPUT`, `#TIMEOUT`, `#DISPOSED`, `#TYPE_MISMATCH`. Provider-specific failures decompose into `(generic atom, meta.provider, meta.raw.kind)` so host scripts match coarsely (`guard #AUTH`) or finely (`guard #UNAVAILABLE && raw.kind == 'connection_failed'`).
- Factory-time configuration validation switches from `RuntimeError('RILL-R005', ...)` to `RuntimeError('RILL-R001', ...)`. Factories now accept an optional `ExtensionFactoryCtx` second argument.
- Cancellation. `ctx.signal` from the factory ctx composes with per-request `AbortController` and `AbortSignal.timeout` via `AbortSignal.any`. Host-script cancellation now reaches in-flight HTTP, SDK, and PTY operations.
- Per-extension `errors.ts` modules removed in built-in extensions (crypto, datetime, exec, fetch, fs-local, kv-file). Consumers that imported `EXT_*` atom constants must switch to the generic taxonomy.
- LLM `mapProviderError` signature gains a leading `ctx` parameter and returns `RillValue` instead of `RuntimeError`. Provider errors surface as `RuntimeHaltSignal` carrying generic atom codes; host scripts that pattern-matched on `RILL-R005` must switch to generic-atom guards.
- Shared search APIs require `RuntimeContext` as the first argument and return `RillValue` instead of throwing `RuntimeError`. Host scripts consuming search extensions can now recover failures via `guard #AUTH`, `guard #RATE_LIMIT`, etc.
- `LlmExtensionContract` and `VectorExtensionContract` test pattern: suites migrated from `.rejects.toThrow(RuntimeError)` to `isInvalid(result)` plus `getStatus(result).code.name` assertions across 60+ test sites.

### Added

- `@rcrsr/rill-ext-kv-shared` adds `mapKvError`, mapping ioredis (`ECONNREFUSED`, `ETIMEDOUT`, `MaxRetriesPerRequestError`, `NOAUTH`) and better-sqlite3 (`SQLITE_BUSY`, `SQLITE_LOCKED`, `SQLITE_READONLY`) to `#UNAVAILABLE`, `#AUTH`, `#CONFLICT`, `#FORBIDDEN`, `#TIMEOUT`.
- `@rcrsr/rill-ext-foundry` `mapRestError` adds full HTTP-status-to-atom mapping: 401→`#AUTH`, 402→`#QUOTA_EXCEEDED`, 403→`#FORBIDDEN`, 404→`#NOT_FOUND`, 408→`#TIMEOUT`, 429→`#RATE_LIMIT`, 5xx→`#UNAVAILABLE`, other→`#PROTOCOL`.
- `@rcrsr/rill-ext-claude-code` introduces `SpawnError` plus `mapSpawnError`. Spawn errors map to `#UNAVAILABLE`/`#FORBIDDEN`; CLI timeout to `#TIMEOUT`; non-zero exit to `#UNAVAILABLE`.
- `@rcrsr/rill-ext-mcp` adds `mapMcpError` and `factoryError` (RILL-R001) helpers; emits `#UNAVAILABLE`/`#TIMEOUT`/`#PROTOCOL`/`#AUTH`/`#NOT_FOUND`/`#INVALID_INPUT`.
- `RuntimeHaltSignal` propagates through LLM tool loops so middleware-thrown halts (e.g. auto-shield `#FORBIDDEN`) reach the host script with their original atom instead of being re-wrapped.
- Per-package `tests/_helpers.ts` files providing `makeFactoryCtx`, `makeRuntimeCtx`, `expectRejectsInvalid`, and halt-assertion helpers (`expectHalt`, `expectRejectedHalt`, `expectThrowHalt`).

### Fixed

- LLM tool-loop `callAPI` catch passes through `RuntimeHaltSignal` so middleware-thrown halts reach the host with the original atom instead of being re-wrapped as "Provider API error: runtime halt".
- Four bare `await expect(...)` test sites that suppressed promise rejections (anthropic, openai functions/generate tests) replaced with `expectRejectedHalt` to actually await and match the halt.

### Documentation

- Error Behavior sections in 21 extension docs rewritten with the canonical Failure / Atom / `meta.raw.kind` table, replacing retired `RILL-R004` references.
- Stale `RILL-R004` references in claude-code, google-workspace, outlook, and prompt-md JSDoc and test descriptions renamed to current atom names.
- `CLAUDE.md` §Error Handling Convention rewritten to describe the generic atom taxonomy and `(atom, provider, raw.kind)` decomposition.

### Tooling

- `packageManager` field bumped to `pnpm@10.33.2`.
- `pnpm.overrides` for the local rill workspace removed; lockfile now resolves `@rcrsr/rill@~0.19.0` from npm.

## [0.18.7] - 2026-04-26

### Added

- New `@rcrsr/rill-ext-google-workspace` extension providing access to Gmail, Google Drive, and Google Calendar via 17 callables, supporting bearer token, session, and service account authentication
- `@rcrsr/rill-ext-google-workspace` exports `extensionManifest` for `rill-run` mounting; ships three runnable rill packages under `examples/` (gmail-triage, drive-upload, calendar-scheduling)

## [0.18.6] - 2026-04-17

### Changed (Breaking)

- `@rcrsr/rill-ext-prompt-md` peer dep on `@rcrsr/rill` bumped from `~0.18.4` to `~0.18.6` to consume the re-exported `tokenize`, `createParserState`, and `parseTypeRef`
- Frontmatter `params` type grammar delegates to rill's `parseTypeRef`. Legacy alias `num` is hard-rejected; use `number`. Legacy alias `callable` is hard-rejected and has no replacement — function-typed params are not supported
- Param type names `closure`, `iterator`, `stream`, `vector`, and `type` are hard-rejected because they render through `formatValue` as placeholder strings (e.g. `type(closure)`, `vector(model, Nd)`) with no useful meaning in prompt text

### Added

- `@rcrsr/rill-ext-prompt-md` frontmatter `params` now accepts full rill type expressions, including parameterized and nested forms (e.g. `list(dict(title: string, body: string))`)
- Template interpolation in prompts renders every `RillValue` via rill's canonical `formatValue` stringifier; dicts and lists produce rill literal syntax

### Fixed

- `@rcrsr/rill-ext-prompt-md` README and docs no longer show invalid unquoted YAML for `params` entries; each entry must be a YAML string literal

## [0.18.5] - 2026-04-17

### Added

- New `@rcrsr/rill-ext-prompt-md` extension loads typed prompt templates from `.prompt.md` files, validates at startup, and exposes them as callables for LLM `messages()` entry points
- New `@rcrsr/rill-ext-foundry` extension for Azure AI Foundry: LLM inference via `AzureOpenAI`, content safety prompt shielding, Bing grounding with citations, and Azure AI Search. Supports `api-key` and Entra ID auth. 10 host functions: `message`, `messages`, `embed`, `embed_batch`, `tool_loop`, `generate`, `shield`, `ground`, `search`, `usage`
- New `@rcrsr/rill-ext-outlook` extension providing access to Microsoft Graph mail and calendar operations including inbox, search, send, draft, reply, flag, events, free-busy, and event creation

### Fixed

- `@rcrsr/rill-ext-prompt-md` now exports `extensionManifest`, enabling `rill-run` auto-mount (previously failed with `does not export extensionManifest`)

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
