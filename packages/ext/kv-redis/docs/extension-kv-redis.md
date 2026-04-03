# kv-redis Extension

*Redis key-value storage backend for rill scripts*

Provides persistent key-value storage using Redis. Alternative to the JSON-backed core kv extension with better performance for distributed systems, caching scenarios, and high-throughput workloads. Scripts use the same 11-function API regardless of backend — hosts swap implementations without changing script code.

Use Redis backend for distributed systems, caching layers, high-throughput workloads, TTL-based expiry, or when integrating with existing Redis infrastructure. Use SQLite for large single-server datasets. Use JSON-backed core kv for simple single-process applications.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "kv": "@rcrsr/rill-ext-kv-redis"
    },
    "config": {
      "kv": {
        "url": "redis://localhost:6379",
        "mounts": {
          "user": {
            "mode": "read-write",
            "prefix": "app:user:"
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
        "url": "redis://localhost:6379",
        "mounts": {
          "user": {
            "mode": "read-write",
            "prefix": "app:user:",
            "schema": { "name": { "type": "string", "default": "" } },
            "maxEntries": 10000,
            "maxValueSize": 102400,
            "ttl": 3600
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
| `url` | string | — | Redis connection URL (required) |
| `mounts` | Record | — | Named mount configurations (required) |
| `maxStoreSize` | number | 10485760 | Maximum store size in bytes |
| `writePolicy` | string | `'dispose'` | When to flush writes |

**Mount parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | string | — | Access mode: `'read'`, `'write'`, or `'read-write'` (required) |
| `prefix` | string | — | Key prefix for namespace isolation (required) |
| `schema` | Record | — | Optional schema for declared mode |
| `maxEntries` | number | 10000 | Maximum entries per mount |
| `maxValueSize` | number | 102400 | Maximum value size in bytes |
| `ttl` | number | — | Key expiry in seconds |

**Example with schema and TTL:**

```json
{
  "extensions": {
    "config": {
      "kv": {
        "url": "redis://localhost:6379",
        "mounts": {
          "user": {
            "mode": "read-write",
            "prefix": "app:user:",
            "schema": {
              "name": { "type": "string", "default": "" },
              "count": { "type": "number", "default": 0 }
            }
          },
          "cache": {
            "mode": "read-write",
            "prefix": "app:cache:",
            "ttl": 3600
          }
        },
        "writePolicy": "immediate"
      }
    }
  }
}
```

**Redis with authentication:**

```json
{
  "extensions": {
    "config": {
      "kv": {
        "url": "redis://${REDIS_USER}:${REDIS_PASSWORD}@host:6379/0",
        "mounts": {
          "session": {
            "mode": "read-write",
            "prefix": "session:",
            "ttl": 1800
          }
        }
      }
    }
  }
}
```

**Redis with TLS:**

```json
{
  "extensions": {
    "config": {
      "kv": {
        "url": "rediss://secure-host:6380",
        "mounts": {
          "data": {
            "mode": "read-write",
            "prefix": "prod:data:",
            "maxEntries": 50000,
            "ttl": 86400
          }
        }
      }
    }
  }
}
```

## Key Features

- TTL support for automatic key expiration
- SCAN-based key listing (production-safe, non-blocking)
- Connection URL format supports authentication and database selection
- TLS support via `rediss://` protocol
- Key prefix isolation enables multi-tenant patterns

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
