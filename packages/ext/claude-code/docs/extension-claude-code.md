# claude_code Extension

*Claude Code CLI integration for AI-powered rill scripts*

This extension spawns the Claude Code CLI as a subprocess and exposes it to rill scripts. Scripts send prompts, invoke skills like `/commit`, and run named commands. The extension handles process lifecycle, timeout enforcement, and NDJSON stream parsing.

Each call returns a `RillStream`. Iterate stdout line chunks with `-> each`, or resolve immediately with `()` to get the result dict containing response text, token usage breakdown, cost in USD, exit code, and duration in ms. Typical uses: automated code review, commit generation, and PR workflows.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "claude_code": "@rcrsr/rill-ext-claude-code"
    },
    "config": {
      "claude_code": {
        "defaultTimeout": 60000
      }
    }
  }
}
```

Rill script — stream stdout line chunks:

```rill
use<ext:claude_code> => $cc
$cc.prompt("Explain TCP handshakes") => $s
$s -> each { log }
```

Resolve immediately to access the result dict:

```rill
claude_code::prompt("Explain TCP handshakes")() => $result
$result.result -> log
```

Secondary pattern (still works, not primary):

```rill
claude_code::prompt("Explain TCP handshakes")
```

## Prerequisites

The extension requires two external dependencies:

- **node-pty** (peer dependency) — Requires native compilation during install
- **claude binary** — Must be in `$PATH` before factory call

The factory validates both requirements eagerly and throws on missing dependencies.

## Configuration

```json
{
  "extensions": {
    "config": {
      "claude_code": {
        "binaryPath": "/usr/local/bin/claude",
        "defaultTimeout": 60000,
        "dangerouslySkipPermissions": true,
        "settingSources": ""
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `binaryPath` | string | `'claude'` | Path to Claude CLI binary |
| `defaultTimeout` | number | `1800000` | Timeout in ms (max: 3600000) |
| `dangerouslySkipPermissions` | boolean | `true` | Skip permission checks |
| `settingSources` | string | `''` | Settings to load at startup |

### settingSources Values

Controls which Claude Code settings load before execution.

| Value | Effect |
|-------|--------|
| `''` (default) | No settings. Disables plugins, MCP servers, slash commands. |
| `'user'` | Load user settings (~/.claude/settings.json) including plugins. |
| `'project'` | Load project settings (.claude/settings.json). |
| `'user,project'` | Load both user and project settings. |

## Functions

**prompt(text, options?)** — Execute a Claude Code prompt. Returns `RillStream`:

```rill
# Stream stdout line chunks
claude_code::prompt("Explain TCP handshakes") => $s
$s -> each { log }

# Or resolve to result dict
claude_code::prompt("Explain TCP handshakes")() => $result
$result.result       # Response text
$result.tokens       # Token usage breakdown
$result.cost         # Cost in USD
$result.exitCode     # CLI exit code
$result.duration     # Execution time in ms
```

**skill(name, args?)** — Execute a Claude Code skill. Returns `RillStream`:

```rill
# Stream stdout line chunks
claude_code::skill("commit", [message: "fix: resolve timeout bug"]) => $s
$s -> each { log }

# Or resolve to result dict
claude_code::skill("commit", [message: "fix: resolve timeout bug"])() => $result
$result.result
```

**command(name, args?)** — Execute a Claude Code command. Returns `RillStream`:

```rill
# Stream stdout line chunks
claude_code::command("review-pr", [pr: "123"]) => $s
$s -> each { log }

# Or resolve to result dict
claude_code::command("review-pr", [pr: "123"])() => $result
$result.result
```

All functions accept an `options` dict as the second parameter.

### PromptOptions

Override timeout per call via `options` dict:

```text
claude_code::prompt("Long task", [timeout: 300000]) => $result
```

| Option | Type | Description |
|--------|------|-------------|
| `timeout` | number | Override defaultTimeout for this call |

## Streaming

All 3 functions return `RillStream`. Two usage patterns:

**Iterate chunks** — process stdout output line-by-line:

```rill
claude_code::prompt("Write a function") => $s
$s -> each { log }
```

**Resolve immediately** — access the full result dict at once:

```rill
claude_code::prompt("Write a function")() => $result
$result.result -> log
```

Each chunk is a string (one stdout line).

## Result Dict

All 3 functions resolve to the same structure:

| Field | Type | Description |
|-------|------|-------------|
| `result` | string | Combined text output |
| `tokens` | dict | Token usage breakdown |
| `tokens.prompt` | number | Non-cached prompt tokens |
| `tokens.cacheWrite5m` | number | 5-minute cache write tokens |
| `tokens.cacheWrite1h` | number | 1-hour cache write tokens |
| `tokens.cacheRead` | number | Cache read tokens |
| `tokens.output` | number | Output tokens |
| `cost` | number | Total cost in USD |
| `exitCode` | number | CLI exit code (0 = success) |
| `duration` | number | Execution time in ms |

## Error Behavior

The extension emits failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #UNAVAILABLE`) or finely
(`guard #UNAVAILABLE && raw.kind == 'binary_not_found'`).

**Host-fn errors:**

| Failure | Atom | `meta.raw.kind` |
|---|---|---|
| Empty prompt / skill / command name | `#INVALID_INPUT` | `invalid_input` |
| Claude binary missing on PATH | `#UNAVAILABLE` | `binary_not_found` |
| Claude binary present but not executable | `#FORBIDDEN` | `binary_eacces` |
| Failed to spawn the CLI process | `#UNAVAILABLE` | `spawn_failed` |
| CLI exceeded configured timeout | `#TIMEOUT` | `cli_timeout` |
| Cooperative cancellation propagated from `ctx.signal` | `#TIMEOUT` | `request_cancelled` |
| CLI exited with a non-zero status | `#UNAVAILABLE` | `exit_nonzero` |
| Other spawn / process failure | `#UNAVAILABLE` | `unknown_error` |

## Events

| Event | Emitted When |
|-------|-------------|
| `claude-code:prompt` | Prompt completes |
| `claude-code:skill` | Skill completes |
| `claude-code:command` | Command completes |
| `claude-code:error` | Any operation fails |

## Low-Level Exports

Advanced use cases can import low-level utilities:

- `createStreamParser()` — Parse NDJSON stream from Claude CLI
- `spawnClaudeCli()` — Spawn process with timeout enforcement
- `extractResult()` — Aggregate messages into result dict

See package source for implementation details.

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
