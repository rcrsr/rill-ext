# kv-file Extension

*File-based JSON key-value storage for rill scripts*

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
            "store": "./data/user.json",
            "schema": {
              "name": { "type": "string", "default": "" },
              "count": { "type": "number", "default": 0 }
            }
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
$kv.mounts() -> log
```

## Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mounts` | Record<string, MountConfig> | — | Mount definitions keyed by name |
| `store` | string | — | Legacy: single store file path |
| `schema` | Record<string, SchemaEntry> | — | Legacy: schema for single-store mode |
| `maxEntries` | number | `10000` | Max entries per mount |
| `maxValueSize` | number | `102400` | Max value size in bytes (100 KB) |
| `maxStoreSize` | number | `10485760` | Max store size in bytes (10 MB) |
| `writePolicy` | string | `"dispose"` | `"dispose"` or `"immediate"` |
| `mode` | string | `"read-write"` | Legacy: `"read"`, `"write"`, or `"read-write"` |

### MountConfig

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | string | required | `"read"`, `"write"`, or `"read-write"` |
| `store` | string | required | Path to JSON store file |
| `schema` | Record<string, SchemaEntry> | — | Schema definitions (enables declared mode) |
| `maxEntries` | number | `10000` | Max entries |
| `maxValueSize` | number | `102400` | Max value size in bytes |
| `maxStoreSize` | number | `10485760` | Max store size in bytes |
| `writePolicy` | string | `"dispose"` | Write policy |

## Functions

### get

Get value by key. Returns empty string for missing keys in open mode. Throws for undeclared keys in declared mode.

### get_or

Get value or return fallback. Never throws for missing keys.

### set

Set value with validation. Checks schema type, value size, entry count, and store size.

### merge

Shallow-merge a partial dict into an existing dict value.

### delete

Delete key. Returns false if key does not exist.

### keys

Get all keys in mount.

### has

Check if key exists.

### clear

Clear all keys. Restores schema defaults in declared mode.

### getAll

Get all entries as a dict.

### schema

Get schema information. Returns empty list in open mode.

### mounts

List all configured mounts with metadata.

## Modes

- **Open mode** (no schema): accepts any key/value
- **Declared mode** (with schema): only schema-defined keys, type-validated

## Errors

| Error | Code | Description |
|-------|------|-------------|
| Key not in schema | RILL-R004 | Key not declared (declared mode) |
| Type mismatch | RILL-R004 | Value type does not match schema |
| Value too large | RILL-R004 | Value exceeds maxValueSize |
| Store too large | RILL-R004 | Store exceeds maxStoreSize |
| Entry limit | RILL-R004 | Exceeds maxEntries |
| Corrupt file | RILL-R004 | JSON store file cannot be parsed |
| Read-only | RILL-R004 | Write operation on read-only mount |
| Mount not found | RILL-R004 | Referenced mount does not exist |
