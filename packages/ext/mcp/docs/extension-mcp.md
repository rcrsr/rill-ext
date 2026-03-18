# mcp Extension

*MCP server integration for rill scripts*

This extension connects rill scripts to Model Context Protocol (MCP) servers. MCP provides a standard interface for exposing tools, resources, and prompts from external services. The host binds the extension to a namespace, and scripts call server functions through three capability dicts: `tools`, `resources`, and `prompts`. Each MCP server generates host functions automatically from its metadata.

The extension supports stdio and HTTP transports. Stdio servers run as child processes (filesystem, database, GitHub). HTTP servers connect to remote endpoints with static or dynamic authentication.

## Value Structure

The extension returns three namespace dicts:

```
ext:mcp
  .tools
    .read_file(path, ...)      # MCP tool
    .search_files(pattern, ...) # MCP tool
  .resources
    .read_resource(uri)         # reads any resource by URI
    .resource_app_log()         # static resource shortcut
  .prompts
    .code_review(code, ...)     # MCP prompt template
    .summarize(text)            # MCP prompt template
```

Each entry in `tools`, `resources`, and `prompts` is a callable with typed parameters derived from the server's metadata.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "fs": "@rcrsr/rill-ext-mcp"
    },
    "config": {
      "fs": {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
        }
      }
    }
  }
}
```

Rill script:

```rill
use<ext:fs> => $fs
$fs.tools.read_file([path: "/tmp/test.txt"]) => $content
$content.content -> log
```

Direct dot-path (no intermediate variable):

```rill
use<ext:fs.tools.read_file>([path: "/tmp/test.txt"]) => $content
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "fs": {
        "transport": { "type": "stdio", "command": "...", "args": [] },
        "timeout": 30000,
        "toolFilter": ["read_file", "write_file"],
        "resourceFilter": ["file:///logs/app.log"],
        "promptFilter": ["summarize"]
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `transport` | object | -- | Transport configuration (required) |
| `timeout` | number | 30000 | Request timeout in ms |
| `toolFilter` | string[] | -- | Include only specified tool names |
| `resourceFilter` | string[] | -- | Include only specified resource URIs |
| `promptFilter` | string[] | -- | Include only specified prompt names |

## Transport Types

### stdio Transport

Run MCP servers as child processes. Use for local tools (filesystem, database CLI, Git).

```json
{
  "type": "stdio",
  "command": "mcp-server-postgres",
  "args": ["--host", "localhost", "--port", "5432"],
  "env": { "DATABASE_URL": "${PG_URL}", "LOG_LEVEL": "info" }
}
```

```json
{
  "extensions": {
    "config": {
      "db": {
        "transport": {
          "type": "stdio",
          "command": "mcp-server-postgres",
          "args": ["--host", "localhost", "--port", "5432"],
          "env": { "DATABASE_URL": "${PG_URL}", "LOG_LEVEL": "info" }
        },
        "timeout": 60000
      }
    }
  }
}
```

### HTTP Transport

Connect to remote MCP servers over HTTP. Use for managed services and internal APIs.

```json
{
  "type": "http",
  "url": "https://mcp.example.com/v1",
  "headers": { "Authorization": "Bearer ${API_KEY}" }
}
```

```json
{
  "extensions": {
    "config": {
      "remote": {
        "transport": {
          "type": "http",
          "url": "https://mcp.example.com/v1",
          "headers": { "Authorization": "Bearer ${API_KEY}" }
        }
      }
    }
  }
}
```


## Capability Dicts

### tools

Each MCP tool becomes a callable in the `tools` dict. Parameters and types derive from the tool's JSON Schema.

```rill
use<ext:fs> => $fs

# List available tools
$fs.tools -> log

# Call a tool
$fs.tools.read_file([path: "/tmp/data.csv"]) => $result
$result.content -> log
```

Tool functions return a dict with a `content` field containing the tool's text output. If the tool returns an error, execution halts with a `RuntimeError`.

### resources

The `resources` dict contains `read_resource` (reads any resource by URI), static resource shortcuts (one per declared resource), and template functions (one per resource template).

```rill
use<ext:fs> => $fs

# Read by URI
$fs.resources.read_resource([uri: "file:///var/log/app.log"]) => $log

# Static resource shortcut (server-declared resource)
$fs.resources.resource_app_log() => $log
```

### prompts

Each MCP prompt becomes a callable in the `prompts` dict. Prompt arguments are string parameters. The function calls `getPrompt` on the server and returns a list of message dicts with `role` and `content` fields.

```rill
use<ext:mcp> => $server
$server.prompts.code_review([code: $source]) => $messages
$messages -> log
# Output: [{ role: "user", content: "Review this code for..." }]
```

Multi-part content from the server is concatenated with newlines. Non-text parts (images) are skipped.

## MCP + LLM Composition

The primary use case for MCP tools is giving an LLM access to external capabilities through `tool_loop`. MCP tools are callables with typed parameters, which is exactly what `tool_loop` accepts.

### Giving an LLM access to MCP tools

Pass the MCP `tools` dict directly to an LLM extension's `tool_loop`:

```json
{
  "extensions": {
    "mounts": {
      "fs": "@rcrsr/rill-ext-mcp",
      "ai": "@rcrsr/rill-ext-anthropic"
    },
    "config": {
      "fs": {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/project"]
        },
        "toolFilter": ["read_file", "list_directory", "search_files"]
      },
      "ai": {
        "api_key": "${ANTHROPIC_API_KEY}",
        "model": "claude-sonnet-4-5-20250929"
      }
    }
  }
}
```

```rill
use<ext:fs> => $fs
use<ext:ai> => $ai

# The LLM calls MCP tools autonomously to answer the question
$ai.tool_loop("Find all TODO comments in the project and summarize them", $fs.tools, [
  max_turns: 10,
]) => $result
$result.content -> log
```

The LLM receives the MCP tools as callable closures with parameter metadata. It decides which tools to call, interprets results, and loops until it has an answer. `$fs.tools` is a dict of callables, which is exactly what `tool_loop` expects.

### Multi-server tool access

Combine tools from multiple MCP servers into a single tool dict:

```json
{
  "extensions": {
    "mounts": {
      "fs": "@rcrsr/rill-ext-mcp",
      "gh": "@rcrsr/rill-ext-mcp",
      "ai": "@rcrsr/rill-ext-anthropic"
    },
    "config": {
      "fs": {
        "transport": { "type": "stdio", "command": "mcp-server-filesystem", "args": ["/tmp"] }
      },
      "gh": {
        "transport": { "type": "stdio", "command": "mcp-server-github" }
      },
      "ai": {
        "api_key": "${ANTHROPIC_API_KEY}",
        "model": "claude-sonnet-4-5-20250929"
      }
    }
  }
}
```

```rill
use<ext:fs> => $fs
use<ext:gh> => $gh
use<ext:ai> => $ai

# Merge tool dicts from both servers
$fs.tools -> .merge($gh.tools) => $all_tools

# LLM can now read files AND interact with GitHub
$ai.tool_loop("Read the README.md and create a GitHub issue for any undocumented features", $all_tools, [
  max_turns: 15,
]) => $result
$result.content -> log
```

### Using prompts with an LLM

MCP prompts return pre-formatted messages. Feed them into an LLM's `messages` function:

```rill
use<ext:mcp> => $server
use<ext:ai> => $ai

# Get structured prompt from MCP server
$server.prompts.code_review([code: $source, language: "typescript"]) => $prompt_messages

# Send prompt messages to the LLM
$ai.messages($prompt_messages) => $result
$result.content -> log
```

### Selective tool exposure

Use `toolFilter` to restrict which MCP tools the LLM can access:

```json
{
  "extensions": {
    "config": {
      "fs": {
        "transport": { "type": "stdio", "command": "mcp-server-filesystem", "args": ["/data"] },
        "toolFilter": ["read_file", "search_files"]
      }
    }
  }
}
```

```rill
use<ext:fs> => $fs
use<ext:ai> => $ai

# LLM can read and search, but cannot write or delete
$ai.tool_loop("Analyze the CSV files in /data and summarize trends", $fs.tools) => $result
$result.content -> log
```

## Filters

Restrict exposed capabilities with filters:

```json
{
  "extensions": {
    "config": {
      "fs": {
        "transport": { "type": "stdio", "command": "..." },
        "toolFilter": ["read_file", "write_file"],
        "resourceFilter": ["file:///logs/app.log"],
        "promptFilter": ["summarize", "analyze"]
      }
    }
  }
}
```

Filters use exact name matching against the MCP server's declared names. Empty arrays include all capabilities. Omitting a filter includes all capabilities.

## Error Behavior

**Connection errors** during `createMcpExtension()`:

- Config validation: `transport.command is required for stdio`
- Process exit: `mcp: failed to connect -- server process exited with code 1`
- Connection refused: `mcp: failed to connect -- connection refused at https://...`
- Auth required: `mcp: server requires authentication -- complete OAuth flow`

**Runtime errors** during script execution (halts with `RuntimeError RILL-R004`):

- Tool execution: `mcp tool "read_file": file not found`
- Protocol error: `mcp: protocol error -- invalid tool name`
- Timeout: `mcp: timeout calling tool "slow_query"`
- Connection lost: `mcp: connection lost to server`
- Auth failed: `mcp: authentication failed`

```rill
use<ext:fs> => $fs

# Check tool availability before calling
$fs.tools.read_file ? {
  $fs.tools.read_file([path: "/tmp/test.txt"]) -> log
} ! {
  "read_file tool not available" -> log
}
```

## Lifecycle

The rill runtime manages connection lifecycle automatically. Connections open when the script starts and close when execution completes.

## See Also

- [rill](https://github.com/rcrsr/rill) -- Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) -- Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) -- Runtime context and host functions
- [MCP Specification](https://spec.modelcontextprotocol.io) -- Model Context Protocol documentation
