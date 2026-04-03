# @rcrsr/rill-ext-kv-sqlite

[rill](https://rill.run) extension for SQLite key-value storage. Provides persistent key-value operations backed by SQLite for large datasets and concurrent access.

## Install

```bash
npm install @rcrsr/rill-ext-kv-sqlite
```

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
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

See [full documentation](docs/extension-kv-sqlite.md) for configuration, functions, mount options, and error handling.

## License

MIT
