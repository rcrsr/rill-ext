# @rcrsr/rill-ext-qdrant

[rill](https://rill.run) extension for [Qdrant](https://qdrant.tech) vector database integration. Provides 11 host functions for vector CRUD, batch operations, and collection management.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-qdrant
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createQdrantExtension } from '@rcrsr/rill-ext-qdrant';

const ext = createQdrantExtension({
  url: 'http://localhost:6333',
  collection: 'my_vectors',
  dimensions: 384,
});
const prefixed = prefixFunctions('qdrant', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `
  qdrant::upsert("doc-1", $embedding, [title: "Example"])
  qdrant::search($embedding, [k: 5]) -> log
`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Documentation

See [full documentation](docs/extension-vectordb-qdrant.md) for configuration, functions, error handling, and local setup.

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
- [Qdrant Documentation](https://qdrant.tech/documentation/) — Official Qdrant docs

## License

MIT
