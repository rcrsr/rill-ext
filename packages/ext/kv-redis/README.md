# @rcrsr/rill-ext-kv-redis

[rill](https://rill.run) extension for Redis key-value storage. Provides persistent key-value operations with TTL support, SCAN-based key listing, and TLS connectivity.

## Install

```bash
npm install @rcrsr/rill-ext-kv-redis
```

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
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

**app.rill**

```rill
use<ext:kv> => $kv

$kv.set("user", "name", "Alice")
$kv.get("user", "name") -> log
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/extension-kv-redis.md) for configuration, functions, mount options, and error handling.

## License

MIT
