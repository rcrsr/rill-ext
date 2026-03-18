# kv-sqlite Extension

*SQLite key-value storage backend for rill scripts*

Provides persistent key-value storage using SQLite databases. Alternative to the JSON-backed core kv extension with better performance for large datasets. Scripts use the same 11-function API regardless of backend — hosts swap implementations without changing script code.

Use SQLite backend when working with large datasets (>1000 entries), need better write performance, or require concurrent access from multiple processes. Use JSON-backed core kv for simple applications with small data volumes.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "kv": "@rcrsr/rill-ext-kv-sqlite"
    },
    "config": {
      "kv": {
        "mounts": {
          "user": {
            "mode": "read-write",
            "database": "./data/app.db",
            "table": "user_state"
          }
        }
      }
    }
  }
}
```

Rill script — load the extension as a handle and call functions via dot-path:

```rill
use<ext:kv> => $store
$store.set("user", "name", "Alice")
$store.get("user", "name") => $name
$name -> log
```

Direct dot-path — no intermediate variable:

```rill
use<ext:kv.set>("user", "name", "Alice")
use<ext:kv.get>("user", "name") => $name
```

Secondary pattern (still works, not primary):

```rill
kv::set("user", "name", "Alice")
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "kv": {
        "mounts": {
          "user": {
            "mode": "read-write",
            "database": "./data/app.db",
            "table": "user_state",
            "schema": { "name": { "type": "string", "default": "" } },
            "maxEntries": 10000,
            "maxValueSize": 102400
          }
        },
        "maxStoreSize": 10485760,
        "writePolicy": "dispose"
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mounts` | Record | — | Named mount configurations (required) |
| `maxStoreSize` | number | 10485760 | Maximum store size in bytes |
| `writePolicy` | string | `'dispose'` | When to flush writes (`'dispose'` or `'immediate'`) |

**Mount parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | string | — | Access mode: `'read'`, `'write'`, or `'read-write'` (required) |
| `database` | string | — | SQLite file path (required) |
| `table` | string | — | Table name (required) |
| `schema` | Record | — | Optional schema for declared mode |
| `maxEntries` | number | 10000 | Maximum entries per mount |
| `maxValueSize` | number | 102400 | Maximum value size in bytes |

**Example with schema:**

```json
{
  "extensions": {
    "config": {
      "kv": {
        "mounts": {
          "user": {
            "mode": "read-write",
            "database": "./data/app.db",
            "table": "user_state",
            "schema": {
              "name": { "type": "string", "default": "" },
              "count": { "type": "number", "default": 0 }
            }
          },
          "cache": {
            "mode": "read-write",
            "database": "./data/cache.db",
            "table": "cache_entries"
          }
        },
        "writePolicy": "immediate"
      }
    }
  }
}
```

## Functions

Provides the same 11 functions as the core kv extension:

| Function | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `get` | mount, key | any | Get value or schema default |
| `get_or` | mount, key, default | any | Get value or provided default |
| `set` | mount, key, value | bool | Set value (validates against schema) |
| `merge` | mount, key, partial | bool | Merge dict fields into existing value |
| `delete` | mount, key | bool | Delete key |
| `keys` | mount | list | Get all keys in mount |
| `has` | mount, key | bool | Check key existence |
| `clear` | mount | bool | Clear all keys (restores schema defaults) |
| `getAll` | mount | dict | Get all entries as dict |
| `schema` | mount | list | Get schema information |
| `mounts` | — | list | Get available mount names |

**Namespace convention:** `kv` or `state`

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
