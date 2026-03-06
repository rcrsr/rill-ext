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
| `packages/ext/example` | `@rcrsr/rill-ext-example` (private) | -- |
| `packages/shared/ext-llm` | `@rcrsr/rill-ext-llm-shared` (private) | -- |
| `packages/shared/ext-vector` | `@rcrsr/rill-ext-vector-shared` (private) | -- |

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

## Core Dependency

All extension packages declare `@rcrsr/rill` as a `peerDependency`. The core runtime is consumed from npm, not from source.

## Release Process

Each extension tracks its own version. Run `./scripts/release.sh` to publish extensions independently.

## Extension Authoring

Each extension provides host functions to a rill runtime. Extensions export a function that accepts a rill `Runtime` and registers host functions on it.

Docs for each extension live in `packages/ext/*/docs/`.
