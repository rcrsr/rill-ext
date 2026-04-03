# @rcrsr/rill-ext-openai

[rill](https://rill.run) extension for [OpenAI](https://platform.openai.com/docs) API integration. Provides `message`, `messages`, `embed`, `embed_batch`, `tool_loop`, and `generate` host functions. Compatible with OpenAI-compatible servers (LM Studio, Ollama, vLLM).

## Install

```bash
npm install @rcrsr/rill-ext-openai
```

## Quick Start

**rill-config.json**

```json
{
  "main": "hello.rill",
  "extensions": {
    "mounts": {
      "llm": "@rcrsr/rill-ext-openai"
    },
    "config": {
      "llm": {
        "api_key": "${OPENAI_API_KEY}",
        "model": "gpt-4o"
      }
    }
  }
}
```

**hello.rill**

```rill
use<ext:llm> => $llm

$llm.message("Explain TCP handshakes") -> each { log }
```

```bash
rill-run
```

For local models, set `base_url` to point at the compatible server:

```json
{
  "llm": {
    "base_url": "http://localhost:1234/v1",
    "model": "llama3"
  }
}
```

## Documentation

See [full documentation](docs/extension-llm-openai.md) for configuration, functions, error handling, events, and examples.

## License

MIT
