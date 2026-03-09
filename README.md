# rill-ext

[![CI](https://github.com/rcrsr/rill-ext/actions/workflows/pr-check.yml/badge.svg?branch=main)](https://github.com/rcrsr/rill-ext/actions/workflows/pr-check.yml)
[![License](https://img.shields.io/github/license/rcrsr/rill-ext)](https://github.com/rcrsr/rill-ext/blob/main/LICENSE)

Vendor extensions for [rill](https://github.com/rcrsr/rill). Each extension is an independent npm package under `@rcrsr/`.

## Packages

### LLM

| Package | npm | Description |
|---------|-----|-------------|
| [`rill-ext-anthropic`](packages/ext/llm-anthropic/docs/extension-llm-anthropic.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-anthropic)](https://www.npmjs.com/package/@rcrsr/rill-ext-anthropic) | Anthropic Claude API |
| [`rill-ext-openai`](packages/ext/llm-openai/docs/extension-llm-openai.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-openai)](https://www.npmjs.com/package/@rcrsr/rill-ext-openai) | OpenAI API |
| [`rill-ext-gemini`](packages/ext/llm-gemini/docs/extension-llm-gemini.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-gemini)](https://www.npmjs.com/package/@rcrsr/rill-ext-gemini) | Google Gemini API |

### Key-Value

| Package | npm | Description |
|---------|-----|-------------|
| [`rill-ext-kv-sqlite`](packages/ext/kv-sqlite/docs/extension-kv-sqlite.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-kv-sqlite)](https://www.npmjs.com/package/@rcrsr/rill-ext-kv-sqlite) | SQLite key-value backend |
| [`rill-ext-kv-redis`](packages/ext/kv-redis/docs/extension-kv-redis.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-kv-redis)](https://www.npmjs.com/package/@rcrsr/rill-ext-kv-redis) | Redis key-value backend |

### Filesystem

| Package | npm | Description |
|---------|-----|-------------|
| [`rill-ext-fs-s3`](packages/ext/fs-s3/docs/extension-fs-s3.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-fs-s3)](https://www.npmjs.com/package/@rcrsr/rill-ext-fs-s3) | S3 filesystem backend |

### Vector Database

| Package | npm | Description |
|---------|-----|-------------|
| [`rill-ext-qdrant`](packages/ext/vectordb-qdrant/docs/extension-vectordb-qdrant.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-qdrant)](https://www.npmjs.com/package/@rcrsr/rill-ext-qdrant) | Qdrant vector database |
| [`rill-ext-pinecone`](packages/ext/vectordb-pinecone/docs/extension-vectordb-pinecone.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-pinecone)](https://www.npmjs.com/package/@rcrsr/rill-ext-pinecone) | Pinecone vector database |
| [`rill-ext-chroma`](packages/ext/vectordb-chroma/docs/extension-vectordb-chroma.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-chroma)](https://www.npmjs.com/package/@rcrsr/rill-ext-chroma) | ChromaDB vector database |

### Other Integrations

| Package | npm | Description |
|---------|-----|-------------|
| [`rill-ext-mcp`](packages/ext/mcp/docs/extension-mcp.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-mcp)](https://www.npmjs.com/package/@rcrsr/rill-ext-mcp) | MCP server integration |
| [`rill-ext-claude-code`](packages/ext/claude-code/docs/extension-claude-code.md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-claude-code)](https://www.npmjs.com/package/@rcrsr/rill-ext-claude-code) | Claude Code CLI |

## Usage

All extensions follow the same factory pattern:

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createAnthropicExtension } from '@rcrsr/rill-ext-anthropic';

const ext = createAnthropicExtension({
  api_key: process.env.ANTHROPIC_API_KEY,
  model: 'claude-sonnet-4-20250514',
});

const { dispose, ...functions } = prefixFunctions('llm', ext);
const ctx = createRuntimeContext({ functions });

// ... execute scripts ...

await dispose();
```

Extensions in the same category share function signatures. Swap providers with no script changes.

## Versioning

Extensions match the **minor** version of `@rcrsr/rill`. Any extension at `0.4.x` works with `rill@0.4.y`. Each extension change bumps the patch version independently.

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [rill-agent](https://github.com/rcrsr/rill-agent) — Agent framework

## License

MIT
