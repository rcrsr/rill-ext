# @rcrsr/rill-ext-exec

[rill](https://rill.run) extension for sandboxed command execution. Provides process spawning with allowlist/blocklist argument validation, timeout enforcement, and output size limits.

## Install

```bash
npm install @rcrsr/rill-ext-exec
```

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "exec": "@rcrsr/rill-ext-exec"
    },
    "config": {
      "exec": {
        "commands": {
          "git": {
            "binary": "git",
            "allowedArgs": ["status", "--short", "log", "--oneline"],
            "cwd": "/home/user/repo"
          }
        }
      }
    }
  }
}
```

**app.rill**

```rill
use<ext:exec> => $exec

$exec.git(["status", "--short"]) -> log
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/extension-exec.md) for configuration, functions, security controls, and error handling.

## License

MIT
