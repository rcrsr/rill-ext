# @rcrsr/rill-ext-claude-code

[rill](https://rill.run) extension for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI integration. Provides `prompt`, `skill`, and `command` host functions with streaming output, token tracking, and process lifecycle management.

## Install

```bash
npm install @rcrsr/rill-ext-claude-code
```

**Peer dependencies:** `node-pty`

## Quick Start

**rill-config.json**

```json
{
  "main": "task.rill",
  "extensions": {
    "mounts": {
      "cc": "@rcrsr/rill-ext-claude-code"
    },
    "config": {
      "cc": {}
    }
  }
}
```

**task.rill**

```rill
use<ext:cc> => $cc

$cc.prompt("Explain TCP handshakes") -> each { log }
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/extension-claude-code.md) for configuration, functions, error handling, events, and examples.

## License

MIT
