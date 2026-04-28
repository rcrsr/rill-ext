# pinecone Extension

*Pinecone vector database integration for rill scripts*

This extension allows rill scripts to access Pinecone's vector database API. The host declares it in `rill-config.json`, and scripts load it with `use<ext:pinecone>`. Switching to Qdrant or Chroma means changing the extension mount. Scripts stay identical.

Eleven functions cover vector operations and collection management. `upsert` and `upsert_batch` insert vectors with metadata. `search` finds k-nearest neighbors. `get` fetches by ID. `delete` and `delete_batch` remove vectors. `count` returns the namespace vector count. `create_collection`, `delete_collection`, `list_collections`, and `describe` manage collections. All operations use the configured index and namespace.

The host sets API key, index name, and namespace at creation time — scripts never handle credentials. Pinecone automatically validates vector dimensions against the index configuration.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "pinecone": "@rcrsr/rill-ext-pinecone"
    },
    "config": {
      "pinecone": {
        "apiKey": "${PINECONE_API_KEY}",
        "index": "my-index",
        "namespace": "default"
      }
    }
  }
}
```

Rill script — load the extension as a handle and call functions via dot-path:

```rill
use<ext:pinecone> => $db
$db.upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example"])
```

Direct dot-path — no intermediate variable:

```rill
use<ext:pinecone.search>([0.1, 0.2, 0.3], [limit: 5]) => $results
$results.matches -> log
```

Secondary pattern (still works, not primary):

```rill
pinecone::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example"])
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "pinecone": {
        "apiKey": "${PINECONE_API_KEY}",
        "index": "my-index",
        "namespace": "production",
        "timeout": 30000
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `apiKey` | string | — | Pinecone API key (required) |
| `index` | string | — | Index name (required) |
| `namespace` | string | `''` | Namespace (empty string allowed) |
| `timeout` | number | `30000` | Request timeout in ms (must be positive integer) |

## Functions

**upsert(id, vector, metadata?)** — Insert or update a vector:

```rill
pinecone::upsert("doc-1", [0.1, 0.2, 0.3], [title: "Example", page: 1]) => $result
$result.upsertedCount -> log
```

**upsert_batch(items)** — Batch insert or update multiple vectors:

```rill
[
  [id: "doc-1", vector: [0.1, 0.2, 0.3], metadata: dict[title: "First"]],
  [id: "doc-2", vector: [0.4, 0.5, 0.6], metadata: dict[title: "Second"]],
] -> pinecone::upsert_batch => $result
$result.upsertedCount -> log
```

**search(vector, options?)** — Search for k-nearest neighbor vectors:

```rill
pinecone::search([0.1, 0.2, 0.3], [limit: 5, minScore: 0.8]) => $results
$results.matches -> log
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | number | `10` | Max results to return |
| `minScore` | number | — | Min similarity score |
| `filter` | dict | — | Metadata filter conditions |
| `includeValues` | boolean | `true` | Include vector values in results |
| `includeMetadata` | boolean | `true` | Include metadata in results |

**get(id)** — Fetch a vector by ID:

```rill
pinecone::get("doc-1") => $record
$record.values -> log
$record.metadata -> log
```

**delete(id)** — Delete a vector by ID:

```rill
pinecone::delete("doc-1")
```

**delete_batch(ids)** — Delete multiple vectors by ID:

```rill
pinecone::delete_batch(["doc-1", "doc-2", "doc-3"])
```

**count()** — Count total vectors in the namespace:

```rill
pinecone::count() => $result
$result.vectorCount -> log
```

**create_collection(name, options?)** — Create a new collection from the current index:

```rill
pinecone::create_collection("backup-2024", [source: "my-index"]) => $result
$result.name -> log
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `source` | string | current index | Source index name |

**delete_collection(id)** — Delete a collection by name:

```rill
pinecone::delete_collection("backup-2023")
```

**list_collections()** — List all collections in the project:

```rill
pinecone::list_collections() => $result
$result.collections -> log
```

**describe()** — Describe the current index:

```rill
pinecone::describe() => $info
$info.dimension -> log
$info.metric -> log
$info.totalVectorCount -> log
```

## Error Behavior

The extension emits failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #NOT_FOUND`) or finely
(`guard #NOT_FOUND && raw.kind == 'id_not_found'`).

**Factory-time validation** (before any host fn runs):

- Missing API key → `RuntimeError RILL-R001: pinecone: apiKey is required`
- Missing index → `RuntimeError RILL-R001: pinecone: index is required`

**Host-fn errors** (during operations):

| Failure | Atom | `meta.raw.kind` |
|---|---|---|
| Authentication failure (401, "unauthorized") | `#AUTH` | `authentication_failed` |
| Index not found | `#NOT_FOUND` | `collection_not_found` |
| ID not found (`get`) | `#NOT_FOUND` | `collection_not_found` |
| Rate limit exceeded (429) | `#RATE_LIMIT` | `rate_limit_exceeded` |
| Network timeout / `AbortError` | `#TIMEOUT` | `request_timeout` |
| Vector dimension mismatch | `#TYPE_MISMATCH` | `dimension_mismatch` |
| Index already exists | `#CONFLICT` | `collection_exists` |
| Invalid `dimensions` arg on `create_collection` | `#INVALID_INPUT` | `invalid_dimensions` |
| Disposed extension / `ctx.signal` aborted | `#DISPOSED` | `disposed` |
| Other SDK errors | `#UNAVAILABLE` | `sdk_error` |

## Cloud Pinecone Setup

Create a free Pinecone account at [pinecone.io](https://www.pinecone.io).

### Create Index

Using the Pinecone CLI:

```bash
pinecone index create my-index \
  --dimension 384 \
  --metric cosine \
  --cloud aws \
  --region us-east-1
```

Or via the Pinecone Console at [app.pinecone.io](https://app.pinecone.io).

### API Key

Find your API key in the Pinecone Console under **API Keys** section.

Default configuration:

```json
{
  "extensions": {
    "config": {
      "pinecone": {
        "apiKey": "${PINECONE_API_KEY}",
        "index": "my-index",
        "namespace": ""
      }
    }
  }
}
```

### Free Tier Limits

Pinecone Starter (free) tier includes:
- 1 project
- 1 serverless index
- 2GB storage
- 10K vectors per namespace

See [Pinecone Pricing](https://www.pinecone.io/pricing/) for current limits.

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
- [Pinecone Documentation](https://docs.pinecone.io) — Official Pinecone docs
