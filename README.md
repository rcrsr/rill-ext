# rill-ext

[![CI](https://github.com/rcrsr/rill-ext/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rcrsr/rill-ext/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/rcrsr/rill-ext)](https://github.com/rcrsr/rill-ext/blob/main/LICENSE)

Official extensions for [rill](https://github.com/rcrsr/rill). Each extension is an independent npm package under `@rcrsr/`.

## Extensions

All packages are published under `@rcrsr/` on npm. Provider categories (**LLM**, **Key-Value**, **Filesystem**, **Vector DB**) share function signatures within their category and are interchangeable. **Standalone** and **Integrations** expose distinct host functions.

| Category | Package | npm | Docs | Description |
|----------|---------|-----|------|-------------|
| **LLM** | [`rill-ext-anthropic`](packages/ext/llm-anthropic) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-anthropic)](https://www.npmjs.com/package/@rcrsr/rill-ext-anthropic) | [docs](packages/ext/llm-anthropic/docs/extension-llm-anthropic.md) | Anthropic Claude |
| | [`rill-ext-openai`](packages/ext/llm-openai) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-openai)](https://www.npmjs.com/package/@rcrsr/rill-ext-openai) | [docs](packages/ext/llm-openai/docs/extension-llm-openai.md) | OpenAI and compatible APIs |
| | [`rill-ext-gemini`](packages/ext/llm-gemini) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-gemini)](https://www.npmjs.com/package/@rcrsr/rill-ext-gemini) | [docs](packages/ext/llm-gemini/docs/extension-llm-gemini.md) | Google Gemini |
| **Key-Value** | [`rill-ext-kv-file`](packages/ext/kv-file) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-kv-file)](https://www.npmjs.com/package/@rcrsr/rill-ext-kv-file) | [docs](packages/ext/kv-file/docs/extension-kv-file.md) | JSON file storage |
| | [`rill-ext-kv-sqlite`](packages/ext/kv-sqlite) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-kv-sqlite)](https://www.npmjs.com/package/@rcrsr/rill-ext-kv-sqlite) | [docs](packages/ext/kv-sqlite/docs/extension-kv-sqlite.md) | SQLite |
| | [`rill-ext-kv-redis`](packages/ext/kv-redis) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-kv-redis)](https://www.npmjs.com/package/@rcrsr/rill-ext-kv-redis) | [docs](packages/ext/kv-redis/docs/extension-kv-redis.md) | Redis |
| **Filesystem** | [`rill-ext-fs-local`](packages/ext/fs-local) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-fs-local)](https://www.npmjs.com/package/@rcrsr/rill-ext-fs-local) | [docs](packages/ext/fs-local/docs/extension-fs-local.md) | Local filesystem (sandboxed) |
| | [`rill-ext-fs-s3`](packages/ext/fs-s3) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-fs-s3)](https://www.npmjs.com/package/@rcrsr/rill-ext-fs-s3) | [docs](packages/ext/fs-s3/docs/extension-fs-s3.md) | S3, R2, MinIO |
| **Vector DB** | [`rill-ext-qdrant`](packages/ext/vectordb-qdrant) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-qdrant)](https://www.npmjs.com/package/@rcrsr/rill-ext-qdrant) | [docs](packages/ext/vectordb-qdrant/docs/extension-vectordb-qdrant.md) | Qdrant |
| | [`rill-ext-pinecone`](packages/ext/vectordb-pinecone) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-pinecone)](https://www.npmjs.com/package/@rcrsr/rill-ext-pinecone) | [docs](packages/ext/vectordb-pinecone/docs/extension-vectordb-pinecone.md) | Pinecone |
| | [`rill-ext-chroma`](packages/ext/vectordb-chroma) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-chroma)](https://www.npmjs.com/package/@rcrsr/rill-ext-chroma) | [docs](packages/ext/vectordb-chroma/docs/extension-vectordb-chroma.md) | ChromaDB |
| **Search** | [`rill-ext-search-brave`](packages/ext/search-brave) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-search-brave)](https://www.npmjs.com/package/@rcrsr/rill-ext-search-brave) | [docs](packages/ext/search-brave/docs/extension-search-brave.md) | Brave Search |
| | [`rill-ext-search-exa`](packages/ext/search-exa) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-search-exa)](https://www.npmjs.com/package/@rcrsr/rill-ext-search-exa) | [docs](packages/ext/search-exa/docs/extension-search-exa.md) | Exa AI search |
| | [`rill-ext-search-searxng`](packages/ext/search-searxng) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-search-searxng)](https://www.npmjs.com/package/@rcrsr/rill-ext-search-searxng) | [docs](packages/ext/search-searxng/docs/extension-search-searxng.md) | SearXNG (self-hosted) |
| | [`rill-ext-search-serper`](packages/ext/search-serper) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-search-serper)](https://www.npmjs.com/package/@rcrsr/rill-ext-search-serper) | [docs](packages/ext/search-serper/docs/extension-search-serper.md) | Serper (Google Search) |
| | [`rill-ext-search-tavily`](packages/ext/search-tavily) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-search-tavily)](https://www.npmjs.com/package/@rcrsr/rill-ext-search-tavily) | [docs](packages/ext/search-tavily/docs/extension-search-tavily.md) | Tavily AI search |
| **Integrations** | [`rill-ext-mcp`](packages/ext/mcp) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-mcp)](https://www.npmjs.com/package/@rcrsr/rill-ext-mcp) | [docs](packages/ext/mcp/docs/extension-mcp.md) | MCP server bridge |
| | [`rill-ext-claude-code`](packages/ext/claude-code) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-claude-code)](https://www.npmjs.com/package/@rcrsr/rill-ext-claude-code) | [docs](packages/ext/claude-code/docs/extension-claude-code.md) | Claude Code CLI |
| | [`rill-ext-foundry`](packages/ext/foundry) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-foundry)](https://www.npmjs.com/package/@rcrsr/rill-ext-foundry) | [docs](packages/ext/foundry/docs/extension-foundry.md) | Azure AI Foundry |
| | [`rill-ext-outlook`](packages/ext/outlook) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-outlook)](https://www.npmjs.com/package/@rcrsr/rill-ext-outlook) | [docs](packages/ext/outlook/docs/extension-outlook.md) | Microsoft Outlook (Graph API) |
| | [`rill-ext-prompt-md`](packages/ext/prompt-md) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-prompt-md)](https://www.npmjs.com/package/@rcrsr/rill-ext-prompt-md) | [docs](packages/ext/prompt-md/docs/extension-prompt-md.md) | Markdown prompt loader |
| **Standalone** | [`rill-ext-crypto`](packages/ext/crypto) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-crypto)](https://www.npmjs.com/package/@rcrsr/rill-ext-crypto) | [docs](packages/ext/crypto/docs/extension-crypto.md) | Hashing, HMAC, UUID, random |
| | [`rill-ext-datetime`](packages/ext/datetime) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-datetime)](https://www.npmjs.com/package/@rcrsr/rill-ext-datetime) | [docs](packages/ext/datetime/docs/extension-datetime.md) | Timezone conversion, formatting, parsing |
| | [`rill-ext-exec`](packages/ext/exec) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-exec)](https://www.npmjs.com/package/@rcrsr/rill-ext-exec) | [docs](packages/ext/exec/docs/extension-exec.md) | Sandboxed command execution |
| | [`rill-ext-fetch`](packages/ext/fetch) | [![npm](https://img.shields.io/npm/v/@rcrsr/rill-ext-fetch)](https://www.npmjs.com/package/@rcrsr/rill-ext-fetch) | [docs](packages/ext/fetch/docs/extension-fetch.md) | HTTP with endpoint allowlisting |

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
