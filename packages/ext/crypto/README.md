# @rcrsr/rill-ext-crypto

[rill](https://rill.run) extension for cryptographic operations. Provides hashing, HMAC signatures, UUID generation, and random byte generation via Node.js crypto module.

## Install

```bash
npm install @rcrsr/rill-ext-crypto
```

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "crypto": "@rcrsr/rill-ext-crypto"
    },
    "config": {
      "crypto": {
        "defaultAlgorithm": "sha256",
        "hmacKey": "my-secret-key"
      }
    }
  }
}
```

**app.rill**

```rill
use<ext:crypto> => $crypto

$crypto.hash("hello world") -> log
$crypto.uuid() -> log
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/extension-crypto.md) for configuration, functions, and error handling.

## License

MIT
