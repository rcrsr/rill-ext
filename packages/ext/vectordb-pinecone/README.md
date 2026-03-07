# @rcrsr/rill-ext-pinecone

[rill](https://rill.run) extension for [Pinecone](https://www.pinecone.io) vector database integration. Provides 11 host functions for vector CRUD, batch operations, and collection management.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-pinecone
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createPineconeExtension } from '@rcrsr/rill-ext-pinecone';

const ext = createPineconeExtension({
  apiKey: process.env.PINECONE_API_KEY!,
  index: 'my-index',
});
const prefixed = prefixFunctions('pinecone', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `
  pinecone::upsert("doc-1", $embedding, [title: "Example"])
  pinecone::search($embedding, [k: 5]) -> log
`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Documentation

See [full documentation](docs/extension-vectordb-pinecone.md) for configuration, functions, error handling, and cloud setup.

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
- [Pinecone Documentation](https://docs.pinecone.io) — Official Pinecone docs

## License

MIT
