# crypto Extension

*Cryptographic operations for rill scripts via Node.js crypto module*

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

// Hash content
$crypto.hash("hello world") -> log

// Generate UUID
$crypto.uuid() -> log

// Random bytes
$crypto.random(16) -> log
```

## Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `defaultAlgorithm` | string | `"sha256"` | Default hash algorithm for hash() and hmac() |
| `hmacKey` | string | — | Secret key for HMAC operations (required if hmac() used) |

## Functions

### hash

Hash content with a specified algorithm. Returns hex-encoded digest.

```rill
$crypto.hash("hello world") -> log
$crypto.hash("hello world", "sha512") -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `input` | string | — | Content to hash |
| `algorithm` | string | config `defaultAlgorithm` | Hash algorithm (sha256, sha512, md5, etc.) |

**Returns:** string (hex-encoded hash)

### hmac

Generate HMAC signature. Requires `hmacKey` in config.

```rill
$crypto.hmac("message to sign") -> log
$crypto.hmac("message", "sha512") -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `input` | string | — | Content to authenticate |
| `algorithm` | string | config `defaultAlgorithm` | Hash algorithm |

**Returns:** string (hex-encoded HMAC)

### uuid

Generate random UUID v4.

```rill
$crypto.uuid() -> log
```

**Returns:** string (UUID v4 format: `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`)

### random

Generate random bytes as hex string.

```rill
$crypto.random(16) -> log
$crypto.random(32) -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `bytes` | number | — | Number of random bytes to generate |

**Returns:** string (hex-encoded random bytes, length = bytes * 2)

## Errors

The extension emits failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #INVALID_INPUT`) or finely
(`guard #INVALID_INPUT && raw.kind == 'unsupported_algorithm'`).

**Host-fn errors:**

| Failure | Atom | `meta.raw.kind` |
|---|---|---|
| Algorithm not available in Node.js crypto | `#INVALID_INPUT` | `unsupported_algorithm` |
| `hmac()` called without `hmacKey` in config | `#INVALID_INPUT` | `missing_hmac_key` |
| `random()` called with non-integer or negative `bytes` | `#INVALID_INPUT` | `invalid_bytes` |
| `random()` called with `bytes` greater than 1 MB | `#INVALID_INPUT` | `bytes_too_large` |

## Supported Algorithms

All algorithms supported by `crypto.getHashes()` in Node.js. Common options:

- `sha256` (default)
- `sha512`
- `sha384`
- `md5`
- `sha1`
