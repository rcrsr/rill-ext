# @rcrsr/rill-ext-claude-code

[rill](https://rill.run) extension for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI integration. Provides `prompt`, `skill`, and `command` host functions with streaming output parsing, token tracking, and process lifecycle management.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-claude-code
```

**Peer dependencies:** `@rcrsr/rill`, `node-pty`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createClaudeCodeExtension } from '@rcrsr/rill-ext-claude-code';

const ext = createClaudeCodeExtension();
const prefixed = prefixFunctions('claude_code', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `claude_code::prompt("Explain TCP handshakes")`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Documentation

See [full documentation](docs/extension-claude-code.md) for configuration, functions, error handling, events, and examples.

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions

## License

MIT
