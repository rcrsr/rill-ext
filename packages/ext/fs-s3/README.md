# @rcrsr/rill-ext-fs-s3

[rill](https://rill.run) extension for S3-compatible object storage. Provides filesystem operations backed by AWS S3, Cloudflare R2, MinIO, and other S3-compatible services.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-fs-s3
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createS3FsExtension } from '@rcrsr/rill-ext-fs-s3';

const ext = createS3FsExtension({
  mounts: {
    data: {
      mode: 'read-write',
      region: 'us-east-1',
      bucket: 'my-app-data',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    },
  },
});
const functions = prefixFunctions('fs', ext);
const ctx = createRuntimeContext({ functions });

// Script: fs::read("data", "report.txt")
```

## Documentation

See [full documentation](docs/extension-fs-s3.md) for configuration, functions, provider examples, and error handling.

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions

## License

MIT
