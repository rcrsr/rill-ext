# @rcrsr/rill-ext-qdrant

[rill](https://rill.run) extension for [Qdrant](https://qdrant.tech) vector database integration. Provides host functions for vector CRUD, batch operations, and collection management.

## Install

```bash
npm install @rcrsr/rill-ext-qdrant
```

## Quick Start

**rill-config.json**

```json
{
  "main": "search.rill",
  "extensions": {
    "mounts": {
      "vec": "@rcrsr/rill-ext-qdrant"
    },
    "config": {
      "vec": {
        "url": "http://localhost:6333",
        "collection": "my_vectors",
        "dimensions": 384
      }
    }
  }
}
```

**search.rill**

```rill
use<ext:vec> => $vec

$vec.upsert("doc-1", $embedding, [title: "Example"])
$vec.search($embedding, [k: 5]) -> log
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/extension-vectordb-qdrant.md) for configuration, functions, error handling, and local setup.

## License

MIT
