# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

rill-ext is a pnpm workspace containing official extensions for the rill language runtime.

| Package | NPM Name | Vendor SDK |
|---------|----------|------------|
| `packages/ext/llm-anthropic` | `@rcrsr/rill-ext-anthropic` | @anthropic-ai/sdk |
| `packages/ext/llm-gemini` | `@rcrsr/rill-ext-gemini` | @google/genai |
| `packages/ext/llm-openai` | `@rcrsr/rill-ext-openai` | openai |
| `packages/ext/mcp` | `@rcrsr/rill-ext-mcp` | @modelcontextprotocol/sdk |
| `packages/ext/claude-code` | `@rcrsr/rill-ext-claude-code` | which, node-pty |
| `packages/ext/kv-redis` | `@rcrsr/rill-ext-kv-redis` | ioredis |
| `packages/ext/kv-sqlite` | `@rcrsr/rill-ext-kv-sqlite` | better-sqlite3 |
| `packages/ext/fs-s3` | `@rcrsr/rill-ext-fs-s3` | @aws-sdk/client-s3 |
| `packages/ext/vectordb-chroma` | `@rcrsr/rill-ext-chroma` | chromadb |
| `packages/ext/vectordb-pinecone` | `@rcrsr/rill-ext-pinecone` | @pinecone-database/pinecone |
| `packages/ext/vectordb-qdrant` | `@rcrsr/rill-ext-qdrant` | @qdrant/js-client-rest |
| `packages/ext/search-brave` | `@rcrsr/rill-ext-search-brave` | fetch (native) |
| `packages/ext/search-exa` | `@rcrsr/rill-ext-search-exa` | fetch (native) |
| `packages/ext/search-searxng` | `@rcrsr/rill-ext-search-searxng` | fetch (native) |
| `packages/ext/search-serper` | `@rcrsr/rill-ext-search-serper` | fetch (native) |
| `packages/ext/search-tavily` | `@rcrsr/rill-ext-search-tavily` | fetch (native) |
| `packages/ext/crypto` | `@rcrsr/rill-ext-crypto` | node:crypto (built-in) |
| `packages/ext/exec` | `@rcrsr/rill-ext-exec` | node:child_process (built-in) |
| `packages/ext/fetch` | `@rcrsr/rill-ext-fetch` | fetch (native) |
| `packages/ext/fs-local` | `@rcrsr/rill-ext-fs-local` | node:fs (built-in) |
| `packages/ext/kv-file` | `@rcrsr/rill-ext-kv-file` | node:fs (built-in) |
| `packages/ext/outlook` | `@rcrsr/rill-ext-outlook` | fetch (native) |
| `packages/ext/google-workspace` | `@rcrsr/rill-ext-google-workspace` | fetch (native), node:crypto (built-in) |
| `packages/ext/foundry` | `@rcrsr/rill-ext-foundry` | openai, @azure/identity (optional) |
| `packages/ext/prompt-md` | `@rcrsr/rill-ext-prompt-md` | yaml |
| `packages/shared/ext-llm` | `@rcrsr/rill-ext-llm-shared` (private) | -- |
| `packages/shared/ext-vector` | `@rcrsr/rill-ext-vector-shared` (private) | -- |
| `packages/shared/ext-kv` | `@rcrsr/rill-ext-kv-shared` (private) | -- |
| `packages/shared/ext-fs` | `@rcrsr/rill-ext-fs-shared` (private) | -- |
| `packages/shared/ext-param` | `@rcrsr/rill-ext-param-shared` (private) | -- |
| `packages/shared/ext-search` | `@rcrsr/rill-ext-search-shared` (private) | -- |
| `packages/shared/ext-prompt` | `@rcrsr/rill-ext-prompt-shared` (private) | -- |

## Commands

```bash
pnpm install             # Install dependencies
pnpm run -r build        # Build all packages
pnpm run -r test         # Run tests
pnpm run -r typecheck    # Type validation
pnpm run -r lint         # Check lint errors
pnpm run -r check        # Complete validation (build, test, lint)
```

Package-specific:

```bash
pnpm --filter @rcrsr/rill-ext-anthropic build
pnpm --filter @rcrsr/rill-ext-anthropic test
```

Run a single test file:

```bash
cd packages/ext/llm-anthropic && npx vitest run tests/tool-loop.test.ts
```

## Core Dependency

All extension packages declare `@rcrsr/rill` as a `peerDependency`. The core runtime is consumed from npm, not from source. Types like `RillValue`, `RuntimeError`, `ExtensionResult`, `RuntimeContext`, and helpers like `isDict`, `isCallable`, `invokeCallable` come from this package.

## Versioning

Extensions use semver with two rules:

1. **Minor version compatibility**: an extension's `peerDependency` on `@rcrsr/rill` matches by minor version (e.g., `rill@0.4.x` works with any extension at `0.4.y`). A rill minor bump requires a corresponding extension minor bump.
2. **Patch version per change**: bump the extension's patch version for each publish, regardless of change size.

## Release Process

Each extension tracks its own version in its `package.json`. Run `./scripts/release.sh` to publish extensions independently. The script validates build, tests, and lint before creating a release tag.

## Architecture

### Extension Factory Pattern

Every extension exports a `create*Extension(config)` factory function that returns an `ExtensionResult`. This result contains named host functions (as `{ fn, params }` objects) and a `dispose()` cleanup function. The factory validates config, instantiates the vendor SDK client, and defines closures over it.

Parameters use `RillParam` shape (4 fields: `name`, `type`, `defaultValue`, `annotations`). Use `p.*` helpers from `@rcrsr/rill-ext-param-shared` to construct params. Apply a `satisfies ExtensionResult` check on the return expression to catch signature drift at compile time.

Example shape:
```typescript
import { p } from '@rcrsr/rill-ext-param-shared';

export function createAnthropicExtension(config: AnthropicExtensionConfig): ExtensionResult {
  // validate config, create SDK client
  return {
    message: {
      fn: async (args, ctx) => { ... },
      params: [p.str('text'), p.dict('options')],
    },
    tool_loop: {
      fn: async (args, ctx) => { ... },
      params: [p.str('text'), p.dict('tools'), p.dict('options')],
    },
    dispose: async () => { ... },
  } satisfies ExtensionResult;
}
```

### Shared Packages

Shared packages (`packages/shared/`) are **bundled into** the consuming extension at build time via `tsup.config.ts` (`noExternal`). They are not published to npm.

- **ext-llm-shared**: Validation (`validateApiKey`, `validateModel`, `validateTemperature`), error mapping (`mapProviderError`), JSON Schema building (`buildJsonSchema`), and tool loop orchestration (`executeToolLoop`). All 3 LLM extensions depend on this.
- **ext-vector-shared**: Error mapping, event emission, batch execution, disposal state, distance normalization, and function wrappers. All 3 vector DB extensions depend on this.
- **ext-kv-shared**: Contract type (`KvExtensionContract`) for compile-time verification of KV extension function signatures. All 3 KV extensions depend on this.
- **ext-fs-shared**: Contract type (`FsExtensionContract`) for compile-time verification of FS extension function signatures. Both FS extensions depend on this.
- **ext-param-shared**: Parameter construction helpers (`p.*`) for building `RillParam` objects. All extensions that declare typed host function parameters depend on this.
- **ext-search-shared**: Validation (`assertRequired`, `validateBaseUrl`), error mapping (`mapSearchError`, `mapProviderSearchError`), event emission, function wrapper (`createSearchFunctionWrapper`), disposal and in-flight request tracking. All 5 search extensions depend on this.

### LLM Extension Call Flow

1. Factory creates vendor SDK client and returns host functions
2. `message()` / `messages()` — single/multi-turn LLM calls, provider-specific request formatting
3. `tool_loop()` — multi-turn tool calling loop:
   - Extension factory validates options and builds provider-specific callbacks (`ToolLoopCallbacks`)
   - Delegates to shared `executeToolLoop()` which handles the loop, tool dispatch via `invokeCallable()`, error tracking, and token aggregation
   - `buildJsonSchema()` converts rill callable parameter metadata to JSON Schema for the provider API
4. `embed()` / `embed_batch()` — text embedding via provider embedding API

### Search Extension Call Flow

1. Factory creates disposal state, in-flight tracking, and wrapped host functions via `createSearchFunctionWrapper`
2. Host functions build HTTP requests via native `fetch()` with `AbortSignal.timeout()`
3. Responses map to rill-compatible dicts; errors map through `mapSearchError`/`mapProviderSearchError`
4. `dispose()` calls `abortAll()` on in-flight requests, then sets disposal flag

### Tool Loop Tools Format

Tools are passed as a rill dict (JS object) mapping `name → callable`. The callable carries its own metadata (description, typed parameters). The shared `executeToolLoop()` iterates `Object.entries(toolsDict)` and calls `buildJsonSchema()` on each callable's params.

### Error Handling Convention

rill 0.19 removed `RILL-R004` from `ERROR_REGISTRY`. Extensions emit failures as invalid `RillValue`s via `ctx.invalidate(error, meta)` from inside host functions, and as `RuntimeError('RILL-R001', message)` from factory-time config validation. Full policy: `.claude/policies/policy-domain-ext.md` §EXT.7.

**Reuse rill core's generic atom taxonomy.** rill core pre-registers 12 atoms at module load: `#ok`, `#R001`, `#TIMEOUT`, `#AUTH`, `#FORBIDDEN`, `#RATE_LIMIT`, `#QUOTA_EXCEEDED`, `#NOT_FOUND`, `#CONFLICT`, `#UNAVAILABLE`, `#PROTOCOL`, `#INVALID_INPUT`, `#DISPOSED`, `#TYPE_MISMATCH`. Use these in `meta.code` directly. Do not define `EXT_<EXTENSION>_*` constants. Do not call `ctx.registerErrorCode` for categories the generic taxonomy already covers.

Provider-specific failures decompose into `(generic atom, meta.provider, meta.raw.kind)`. Example: Tavily 432 → `{ code: 'QUOTA_EXCEEDED', provider: 'tavily', raw: { kind: 'plan_limit_exceeded', status: 432 } }`. Host scripts match coarsely (`guard #QUOTA_EXCEEDED`) or finely (`guard #QUOTA_EXCEEDED && raw.kind == 'plan_limit_exceeded'`).

### Build Toolchain

- **tsup**: Bundles each package to ESM (`dist/index.js`)
- **dts-bundle-generator**: Produces rolled-up type declarations (`dist/index.d.ts`)
- **vitest**: Test runner with per-package `vitest.config.ts`

### Test Patterns

- SDK clients are mocked at module level with `vi.mock()` (not real API calls)
- Tests use `createRuntimeContext()` from `@rcrsr/rill` to create test contexts
- Callable values in tests use either `callable()` helper or manual `{ __type: 'callable', kind: 'runtime', isProperty: false, fn }` objects
- Integration tests for external services (Redis, MinIO, ChromaDB) skip gracefully when the service is unavailable

## Extension Authoring

Docs for each extension live in `packages/ext/*/docs/`.
