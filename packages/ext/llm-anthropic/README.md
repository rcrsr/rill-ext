# @rcrsr/rill-ext-anthropic

[rill](https://rill.run) extension for [Anthropic Claude](https://docs.anthropic.com) API integration. Provides `message`, `messages`, `embed`, `embed_batch`, `tool_loop`, and `generate` host functions.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-anthropic
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createAnthropicExtension } from '@rcrsr/rill-ext-anthropic';

const ext = createAnthropicExtension({
  api_key: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-5-20250929',
});
const prefixed = prefixFunctions('anthropic', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `anthropic::message("Explain TCP handshakes")`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Documentation

See [full documentation](docs/extension-llm-anthropic.md) for configuration, functions, error handling, events, and examples.

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions

## License

MIT
