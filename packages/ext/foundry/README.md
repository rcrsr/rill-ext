# @rcrsr/rill-ext-foundry

[rill](https://rill.run) extension for [Azure AI Foundry](https://learn.microsoft.com/azure/ai-services/openai/) integration. Provides `message`, `messages`, `embed`, `embed_batch`, `tool_loop`, `generate`, `shield`, `ground`, and `search` host functions.

## Install

```bash
npm install @rcrsr/rill-ext-foundry openai
# For Entra ID (recommended for production):
npm install @azure/identity
```

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "foundry": "@rcrsr/rill-ext-foundry"
    },
    "config": {
      "foundry": {
        "endpoint": "https://my-resource.openai.azure.com",
        "auth": {
          "type": "api-key",
          "key": "${AZURE_OPENAI_API_KEY}"
        },
        "inference": {
          "model": "gpt-4o",
          "apiVersion": "2025-01-01-preview"
        }
      }
    }
  }
}
```

**app.rill**

```rill
use<ext:foundry> => $foundry

$foundry.message("Explain TCP handshakes") -> each { log }
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/extension-foundry.md) for configuration, functions, error handling, and events.

## License

MIT
