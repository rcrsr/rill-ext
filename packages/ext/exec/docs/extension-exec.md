# exec Extension

*Sandboxed command execution for rill scripts*

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
          },
          "curl": {
            "binary": "curl",
            "blockedArgs": ["--upload-file", "-T"],
            "timeout": 10000
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
$exec.commands() -> log
```

## Configuration

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `commands` | Record<string, CommandConfig> | required | Command definitions keyed by name |
| `timeout` | number | `30000` | Global timeout in ms |
| `maxOutputSize` | number | `1048576` | Global output size limit in bytes |
| `inheritEnv` | boolean | `false` | Inherit parent process environment |

### CommandConfig

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `binary` | string | required | Binary executable path |
| `timeout` | number | global | Command-specific timeout in ms |
| `maxBuffer` | number | global | Command-specific output limit |
| `allowedArgs` | string[] | — | Allowlist mode: only these args permitted |
| `blockedArgs` | string[] | — | Blocklist mode: these args rejected |
| `cwd` | string | — | Working directory |
| `env` | Record<string, string> | — | Environment variables |
| `stdin` | boolean | `false` | Accept stdin input |
| `description` | string | — | Description for introspection |

## Functions

Each declared command becomes a callable function.

### [commandName]

Execute the named command.

```rill
$exec.git(["status", "--short"]) -> log
$exec.echo(["hello", "world"]) -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `args` | list | `[]` | Command arguments |
| `stdin` | string | `""` | Standard input data |

**Returns:** dict with `stdout`, `stderr`, `exitCode`

### commands

List all configured commands.

```rill
$exec.commands() -> log
```

**Returns:** list of `{name, description}` dicts

## Security

- Uses `execFile()` (no shell interpolation)
- Allowlist/blocklist argument validation
- Scripts cannot execute undeclared binaries
- Timeout and output size enforcement
- Optional environment isolation

## Errors

| Error | Code | Description |
|-------|------|-------------|
| Arg not in allowlist | RILL-R004 | Argument not permitted by allowedArgs |
| Arg in blocklist | RILL-R004 | Argument rejected by blockedArgs |
| Binary not found | RILL-R004 | Executable not found at path |
| Output exceeds limit | RILL-R004 | stdout/stderr exceeds maxBuffer |
| Stdin not supported | RILL-R004 | stdin provided but command has stdin: false |
| Command timeout | RILL-R012 | Command exceeded timeout limit |
