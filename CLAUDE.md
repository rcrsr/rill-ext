# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

rill-ext is a pnpm workspace containing vendor extensions for the rill language runtime.

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
| `packages/shared/ext-llm` | `@rcrsr/rill-ext-llm-shared` (private) | -- |
| `packages/shared/ext-vector` | `@rcrsr/rill-ext-vector-shared` (private) | -- |
| `packages/shared/ext-param` | `@rcrsr/rill-ext-param-shared` (private) | -- |

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
      params: [p.string('text'), p.dict('options').optional()],
    },
    tool_loop: {
      fn: async (args, ctx) => { ... },
      params: [p.string('text'), p.dict('tools'), p.dict('options').optional()],
    },
    dispose: async () => { ... },
  } satisfies ExtensionResult;
}
```

### Shared Packages

Shared packages (`packages/shared/`) are **bundled into** the consuming extension at build time via `tsup.config.ts` (`noExternal`). They are not published to npm.

- **ext-llm-shared**: Validation (`validateApiKey`, `validateModel`, `validateTemperature`), error mapping (`mapProviderError`), JSON Schema building (`buildJsonSchema`), and tool loop orchestration (`executeToolLoop`). All 3 LLM extensions depend on this.
- **ext-vector-shared**: Error mapping, event emission, batch execution, disposal state, distance normalization, and function wrappers. All 3 vector DB extensions depend on this.
- **ext-param-shared**: Parameter construction helpers (`p.*`) for building `RillParam` objects. All extensions that declare typed host function parameters depend on this.

### LLM Extension Call Flow

1. Factory creates vendor SDK client and returns host functions
2. `message()` / `messages()` — single/multi-turn LLM calls, provider-specific request formatting
3. `tool_loop()` — multi-turn tool calling loop:
   - Extension factory validates options and builds provider-specific callbacks (`ToolLoopCallbacks`)
   - Delegates to shared `executeToolLoop()` which handles the loop, tool dispatch via `invokeCallable()`, error tracking, and token aggregation
   - `buildJsonSchema()` converts rill callable parameter metadata to JSON Schema for the provider API
4. `embed()` / `embed_batch()` — text embedding via provider embedding API

### Tool Loop Tools Format

Tools are passed as a rill dict (JS object) mapping `name → callable`. The callable carries its own metadata (description, typed parameters). The shared `executeToolLoop()` iterates `Object.entries(toolsDict)` and calls `buildJsonSchema()` on each callable's params.

### Error Handling Convention

Extensions use `RuntimeError` with error code `RILL-R004` for extension-level errors. Shared validation uses `RILL-R001`. The `wrapValidation()` pattern in factory files converts shared `RILL-R001` errors to `RILL-R004` for consistency. Provider SDK errors are mapped through `mapProviderError()` with provider-specific `ProviderErrorDetector` functions.

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
