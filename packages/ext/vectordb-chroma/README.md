# @rcrsr/rill-ext-chroma

[rill](https://rill.run) extension for [ChromaDB](https://www.trychroma.com) vector database integration. Provides host functions for vector CRUD, batch operations, and collection management.

## Install

```bash
npm install @rcrsr/rill-ext-chroma
```

## Quick Start

**rill-config.json**

```json
{
  "main": "search.rill",
  "extensions": {
    "mounts": {
      "vec": "@rcrsr/rill-ext-chroma"
    },
    "config": {
      "vec": {
        "collection": "my_vectors"
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

See [full documentation](docs/extension-vectordb-chroma.md) for configuration, functions, error handling, and local setup.

## License

MIT
