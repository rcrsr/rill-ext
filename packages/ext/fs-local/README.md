# @rcrsr/rill-ext-fs-local

Local filesystem extension for rill with mount-based sandboxing.

## Install

```bash
npm install @rcrsr/rill-ext-fs-local
```

## Usage

```typescript
import { createLocalFsExtension } from '@rcrsr/rill-ext-fs-local';

const ext = await createLocalFsExtension({
  mounts: {
    workspace: {
      path: '/home/user/project',
      mode: 'read-write',
    },
  },
});
```

See `docs/extension-fs-local.md` for full documentation.

## License

MIT
