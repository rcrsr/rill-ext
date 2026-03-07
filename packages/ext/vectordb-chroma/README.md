# @rcrsr/rill-ext-chroma

[rill](https://rill.run) extension for [ChromaDB](https://www.trychroma.com) vector database integration. Provides 11 host functions for vector CRUD, batch operations, and collection management.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-chroma
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createChromaExtension } from '@rcrsr/rill-ext-chroma';

const ext = createChromaExtension({
  collection: 'my_vectors',
});
const prefixed = prefixFunctions('chroma', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `
  chroma::upsert("doc-1", $embedding, [title: "Example"])
  chroma::search($embedding, [k: 5]) -> log
`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Documentation

See [full documentation](docs/extension-vectordb-chroma.md) for configuration, functions, error handling, and local setup.

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
- [ChromaDB Documentation](https://docs.trychroma.com) — Official ChromaDB docs

## License

MIT
