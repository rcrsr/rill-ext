# @rcrsr/rill-ext-fs-s3

[rill](https://rill.run) extension for S3-compatible object storage. Provides filesystem operations backed by AWS S3, Cloudflare R2, MinIO, and other S3-compatible services.

## Install

```bash
npm install @rcrsr/rill-ext-fs-s3
```

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
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

**app.rill**

```rill
use<ext:fs> => $fs

$fs.read("/data/report.txt") -> log
$fs.write("/data/output.txt", "Hello from rill")
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/extension-fs-s3.md) for configuration, functions, provider examples, and error handling.

## License

MIT
