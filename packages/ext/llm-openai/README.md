# @rcrsr/rill-ext-openai

[rill](https://rill.run) extension for [OpenAI](https://platform.openai.com/docs) API integration. Provides `message`, `messages`, `embed`, `embed_batch`, `tool_loop`, and `generate` host functions. Compatible with any OpenAI-compatible server (LM Studio, Ollama, vLLM).

> **Experimental.** Breaking changes will occur before stabilization.

## Install

```bash
npm install @rcrsr/rill-ext-openai
```

**Peer dependencies:** `@rcrsr/rill`

## Quick Start

```typescript
import { parse, execute, createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createOpenAIExtension } from '@rcrsr/rill-ext-openai';

const ext = createOpenAIExtension({
  api_key: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o',
});
const prefixed = prefixFunctions('openai', ext);
const { dispose, ...functions } = prefixed;

const ctx = createRuntimeContext({
  functions,
  callbacks: { onLog: (v) => console.log(v) },
});

const script = `openai::message("Explain TCP handshakes")`;
const result = await execute(parse(script), ctx);

dispose?.();
```

## Documentation

See [full documentation](docs/extension-llm-openai.md) for configuration, functions, error handling, events, and examples.

## Related

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions

## License

MIT
