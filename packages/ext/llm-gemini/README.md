# @rcrsr/rill-ext-gemini

[rill](https://rill.run) extension for [Google Gemini](https://ai.google.dev/docs) API integration. Provides `message`, `messages`, `embed`, `embed_batch`, `tool_loop`, and `generate` host functions.

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-gemini
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createGeminiExtension } from '@rcrsr/rill-ext-gemini';

const ext = createGeminiExtension({
  api_key: process.env.GOOGLE_API_KEY!,
  model: 'gemini-2.0-flash',
});
const prefixed = prefixFunctions('gemini', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `gemini::message("Explain TCP handshakes")`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Documentation

See [full documentation](docs/extension-llm-gemini.md) for configuration, functions, error handling, events, and examples.

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions

## License

MIT
