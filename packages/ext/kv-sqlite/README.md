# @rcrsr/rill-ext-kv-sqlite

[rill](https://rill.run) extension for SQLite key-value storage. Provides persistent key-value operations backed by SQLite databases for large datasets and concurrent access.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-kv-sqlite
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createSqliteKvExtension } from '@rcrsr/rill-ext-kv-sqlite';

const ext = createSqliteKvExtension({
  mounts: {
    user: {
      mode: 'read-write',
      database: './data/app.db',
      table: 'user_state',
    },
  },
});
const functions = prefixFunctions('kv', ext);
const ctx = createRuntimeContext({ functions });

// Script: kv::set("user", "name", "Alice")
```

## Documentation

See [full documentation](docs/extension-kv-sqlite.md) for configuration, functions, mount options, and error handling.

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions

## License

MIT
