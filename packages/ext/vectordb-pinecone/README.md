# @rcrsr/rill-ext-pinecone

[rill](https://rill.run) extension for [Pinecone](https://www.pinecone.io) vector database integration. Provides host functions for vector CRUD, batch operations, and collection management.

## Install

```bash
npm install @rcrsr/rill-ext-pinecone
```

## Quick Start

**rill-config.json**

```json
{
  "main": "search.rill",
  "extensions": {
    "mounts": {
      "vec": "@rcrsr/rill-ext-pinecone"
    },
    "config": {
      "vec": {
        "apiKey": "${PINECONE_API_KEY}",
        "index": "my-index"
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

See [full documentation](docs/extension-vectordb-pinecone.md) for configuration, functions, error handling, and cloud setup.

## License

MIT
