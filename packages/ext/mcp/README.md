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
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createMcpExtension } from '@rcrsr/rill-ext-mcp';

const ext = await createMcpExtension({
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  },
});
const prefixed = prefixFunctions('fs', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `fs::list_tools() -> log`;
const result = await execute(parse(script), ctx);

dispose?.();
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
