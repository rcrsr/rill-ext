# @rcrsr/rill-ext-mcp

[rill](https://rill.run) extension for [Model Context Protocol (MCP)](https://modelcontextprotocol.io) integration. Generates host functions dynamically from MCP server capabilities. Supports stdio and HTTP transports with static and dynamic authentication.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-mcp
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { createRuntimeContext, extResolver, hoistExtension } from '@rcrsr/rill';
import { createMcpExtension } from '@rcrsr/rill-ext-mcp';

const ext = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  },
});
const { functions, dispose } = hoistExtension('fs', ext);
const ctx = createRuntimeContext({
  resolvers: { ext: extResolver },
  configurations: {
    resolvers: { ext: { fs: functions } },
  },
});
```

```rill
use<ext:fs> => $fs
$fs.tools.list_directory([path: "/tmp"]) => $listing
$listing.content -> log
```

## Documentation

See [full documentation](docs/extension-mcp.md) for configuration, transport types, authentication patterns, error handling, and examples.

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
- [MCP Specification](https://spec.modelcontextprotocol.io) — Model Context Protocol documentation

## License

MIT
