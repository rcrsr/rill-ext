# @rcrsr/rill-ext-gemini

[rill](https://rill.run) extension for [Google Gemini](https://ai.google.dev/docs) API integration. Provides `message`, `messages`, `embed`, `embed_batch`, `tool_loop`, and `generate` host functions.

## Install

```bash
npm install @rcrsr/rill-ext-gemini
```

## Quick Start

**rill-config.json**

```json
{
  "main": "hello.rill",
  "extensions": {
    "mounts": {
      "llm": "@rcrsr/rill-ext-gemini"
    },
    "config": {
      "llm": {
        "api_key": "${GOOGLE_API_KEY}",
        "model": "gemini-2.0-flash"
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

See [full documentation](docs/extension-llm-gemini.md) for configuration, functions, error handling, events, and examples.

## License

MIT
