# @rcrsr/rill-ext-mcp

[rill](https://rill.run) extension for [Model Context Protocol (MCP)](https://modelcontextprotocol.io) integration. Generates host functions dynamically from MCP server capabilities. Supports stdio and HTTP transports.

## Install

```bash
npm install @rcrsr/rill-ext-mcp
```

## Quick Start

**rill-config.json**

```json
{
  "main": "browse.rill",
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

**browse.rill**

```rill
use<ext:fs> => $fs

$fs.tools.list_directory([path: "/tmp"]) => $listing
$listing.content -> log
```

```bash
rill-run
```

The extension discovers the MCP server's capabilities at startup and exposes them as callable dicts under `tools`, `resources`, and `prompts`.

## Documentation

See [full documentation](docs/extension-mcp.md) for configuration, transport types, authentication patterns, error handling, and examples.

## License

MIT
