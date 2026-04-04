# rill-ext

[![CI](https://github.com/rcrsr/rill-ext/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rcrsr/rill-ext/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/rcrsr/rill-ext)](https://github.com/rcrsr/rill-ext/blob/main/LICENSE)

Vendor extensions for [rill](https://github.com/rcrsr/rill). Each extension is an independent npm package under `@rcrsr/`.

## Extensions

All packages are published under `@rcrsr/` on npm. Extensions in the same category share function signatures and are interchangeable.

| Category | Package | Docs | Description |
|----------|---------|------|-------------|
| **LLM** | `rill-ext-anthropic` | [docs](packages/ext/llm-anthropic/docs/extension-llm-anthropic.md) | Anthropic Claude |
| | `rill-ext-openai` | [docs](packages/ext/llm-openai/docs/extension-llm-openai.md) | OpenAI and compatible APIs |
| | `rill-ext-gemini` | [docs](packages/ext/llm-gemini/docs/extension-llm-gemini.md) | Google Gemini |
| **Key-Value** | `rill-ext-kv-file` | [docs](packages/ext/kv-file/docs/extension-kv-file.md) | JSON file storage |
| | `rill-ext-kv-sqlite` | [docs](packages/ext/kv-sqlite/docs/extension-kv-sqlite.md) | SQLite |
| | `rill-ext-kv-redis` | [docs](packages/ext/kv-redis/docs/extension-kv-redis.md) | Redis |
| **Filesystem** | `rill-ext-fs-local` | [docs](packages/ext/fs-local/docs/extension-fs-local.md) | Local filesystem (sandboxed) |
| | `rill-ext-fs-s3` | [docs](packages/ext/fs-s3/docs/extension-fs-s3.md) | S3, R2, MinIO |
| **Vector DB** | `rill-ext-qdrant` | [docs](packages/ext/vectordb-qdrant/docs/extension-vectordb-qdrant.md) | Qdrant |
| | `rill-ext-pinecone` | [docs](packages/ext/vectordb-pinecone/docs/extension-vectordb-pinecone.md) | Pinecone |
| | `rill-ext-chroma` | [docs](packages/ext/vectordb-chroma/docs/extension-vectordb-chroma.md) | ChromaDB |
| **Search** | `rill-ext-brave` | [docs](packages/ext/search-brave/docs/extension-search-brave.md) | Brave Search |
| | `rill-ext-exa` | [docs](packages/ext/search-exa/docs/extension-search-exa.md) | Exa AI search |
| | `rill-ext-searxng` | [docs](packages/ext/search-searxng/docs/extension-search-searxng.md) | SearXNG (self-hosted) |
| | `rill-ext-serper` | [docs](packages/ext/search-serper/docs/extension-search-serper.md) | Serper (Google Search) |
| | `rill-ext-tavily` | [docs](packages/ext/search-tavily/docs/extension-search-tavily.md) | Tavily AI search |
| **Integrations** | `rill-ext-mcp` | [docs](packages/ext/mcp/docs/extension-mcp.md) | MCP server bridge |
| | `rill-ext-claude-code` | [docs](packages/ext/claude-code/docs/extension-claude-code.md) | Claude Code CLI |
| **Standalone** | `rill-ext-crypto` | [docs](packages/ext/crypto/docs/extension-crypto.md) | Hashing, HMAC, UUID, random |
| | `rill-ext-exec` | [docs](packages/ext/exec/docs/extension-exec.md) | Sandboxed command execution |
| | `rill-ext-fetch` | [docs](packages/ext/fetch/docs/extension-fetch.md) | HTTP with endpoint allowlisting |

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
