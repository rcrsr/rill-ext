# @rcrsr/rill-ext-kv-file

[rill](https://rill.run) extension for file-based JSON key-value storage. Provides persistent key-value operations with schema validation, size limits, and atomic writes.

## Install

```bash
npm install @rcrsr/rill-ext-kv-file
```

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "kv": "@rcrsr/rill-ext-kv-file"
    },
    "config": {
      "kv": {
        "mounts": {
          "user": {
            "mode": "read-write",
            "store": "./data/user.json"
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

See [full documentation](docs/extension-kv-file.md) for configuration, functions, schema validation, and error handling.

## License

MIT
