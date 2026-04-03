# fs-s3 Extension

*S3-compatible object storage backend for rill scripts*

Provides filesystem operations for S3-compatible object storage. Alternative to the core fs extension for cloud storage scenarios. Supports AWS S3, Cloudflare R2, MinIO, and other S3-compatible services. Scripts use the same 12-function API regardless of backend — hosts swap implementations without changing script code.

Use S3 fs backend for cloud deployments, serverless environments, multi-region data access, or when working with existing S3 infrastructure. Use core fs for local file operations or single-machine deployments.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "fs": "@rcrsr/rill-ext-fs-s3"
    },
    "config": {
      "fs": {
        "mounts": {
          "data": {
            "mode": "read-write",
            "region": "us-east-1",
            "bucket": "my-app-data",
            "credentials": {
              "accessKeyId": "${AWS_ACCESS_KEY_ID}",
              "secretAccessKey": "${AWS_SECRET_ACCESS_KEY}"
            }
          }
        }
      }
    }
  }
}
```

Rill script — load the extension as a handle and call functions via dot-path:

```rill
use<ext:fs> => $storage
$storage.read("/data/report.txt") => $content
$content -> log
```

Direct dot-path — no intermediate variable:

```rill
use<ext:fs.read>("/data/report.txt") => $content
```

Secondary pattern (still works, not primary):

```rill
fs::read("/data/report.txt")
```

All path arguments use a combined `/mount/path` string. The first segment after `/` identifies the mount name. The extension uses longest-match routing when mount names overlap.

## Configuration

```json
{
  "extensions": {
    "config": {
      "fs": {
        "mounts": {
          "data": {
            "mode": "read-write",
            "region": "us-east-1",
            "bucket": "my-app-data",
            "prefix": "uploads/",
            "credentials": {
              "accessKeyId": "${AWS_ACCESS_KEY_ID}",
              "secretAccessKey": "${AWS_SECRET_ACCESS_KEY}"
            },
            "endpoint": "https://custom.endpoint.com",
            "forcePathStyle": false,
            "glob": "*.csv"
          }
        },
        "maxFileSize": 10485760,
        "encoding": "utf-8"
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mounts` | Record | — | Named mount configurations (required) |
| `maxFileSize` | number | 10485760 | Maximum file size in bytes |
| `encoding` | string | `'utf-8'` | File content encoding |

**Mount parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | string | — | Access mode: `'read-only'` or `'read-write'` (required) |
| `region` | string | — | AWS region or `'auto'` for R2 (required) |
| `bucket` | string | — | S3 bucket name (required) |
| `prefix` | string | — | Object key prefix for namespace isolation |
| `credentials` | object | — | AWS credentials (required) |
| `endpoint` | string | — | Custom endpoint for S3-compatible services |
| `forcePathStyle` | boolean | false | Path-style addressing (required for MinIO) |
| `glob` | string | — | File filter pattern |

**Cloudflare R2:**

```json
{
  "extensions": {
    "config": {
      "fs": {
        "mounts": {
          "storage": {
            "mode": "read-write",
            "region": "auto",
            "bucket": "my-r2-bucket",
            "credentials": {
              "accessKeyId": "${R2_ACCESS_KEY_ID}",
              "secretAccessKey": "${R2_SECRET_ACCESS_KEY}"
            },
            "endpoint": "https://<account-id>.r2.cloudflarestorage.com"
          }
        }
      }
    }
  }
}
```

**MinIO:**

```json
{
  "extensions": {
    "config": {
      "fs": {
        "mounts": {
          "local": {
            "mode": "read-write",
            "region": "us-east-1",
            "bucket": "test-bucket",
            "credentials": {
              "accessKeyId": "minioadmin",
              "secretAccessKey": "minioadmin"
            },
            "endpoint": "http://localhost:9000",
            "forcePathStyle": true
          }
        }
      }
    }
  }
}
```

## Key Differences from Core fs

- `endpoint` option enables S3-compatible services beyond AWS (MinIO, Cloudflare R2, DigitalOcean Spaces)
- `forcePathStyle: true` required for services using path-style bucket addressing (`http://host/bucket/key` instead of `http://bucket.host/key`)
- `prefix` option maps mount paths to S3 object key prefixes for namespace isolation within buckets
- Object keys replace filesystem paths, enabling cloud-native storage patterns

## Functions

Provides the same 12 functions as the core fs extension:

| Function | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `read` | path | string | Read file contents |
| `write` | path, content | string | Write file (bytes written) |
| `append` | path, content | string | Append to file (bytes written) |
| `list` | path | list | Directory contents |
| `find` | path, pattern? | list | Recursive file search with glob |
| `exists` | path | bool | Check file existence |
| `remove` | path | bool | Delete file |
| `stat` | path | dict | File metadata (`name`, `type`, `modified`) |
| `mkdir` | path | bool | Create directory |
| `copy` | src, dest | bool | Copy file (same mount) |
| `move` | src, dest | bool | Move file (same mount) |
| `mounts` | — | list | List configured mount details |

All `path`, `src`, and `dest` arguments use `/mount/path` format. `stat` returns `name`, `type`, and `modified` (ISO 8601 string). `copy` and `move` validate that src and dest share the same mount.

**Namespace convention:** `fs` or `s3`

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
