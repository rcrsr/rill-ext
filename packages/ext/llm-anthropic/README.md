# @rcrsr/rill-ext-anthropic

[rill](https://rill.run) extension for [Anthropic Claude](https://docs.anthropic.com) API integration. Provides `message`, `messages`, `embed`, `embed_batch`, `tool_loop`, and `generate` host functions.

## Install

```bash
npm install @rcrsr/rill-ext-anthropic
```

## Quick Start

**rill-config.json**

```json
{
  "main": "hello.rill",
  "extensions": {
    "mounts": {
      "llm": "@rcrsr/rill-ext-anthropic"
    },
    "config": {
      "llm": {
        "api_key": "${ANTHROPIC_API_KEY}",
        "model": "claude-sonnet-4-5-20250929"
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

## Documentation

See [full documentation](docs/extension-llm-anthropic.md) for configuration, functions, error handling, events, and examples.

## License

MIT
