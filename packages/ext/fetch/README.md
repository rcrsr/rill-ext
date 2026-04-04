# @rcrsr/rill-ext-fetch

[rill](https://rill.run) extension for HTTP fetch with configurable endpoints. Provides typed endpoint functions, retry logic, concurrency control, and timeout enforcement.

## Install

```bash
npm install @rcrsr/rill-ext-fetch
```

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "api": "@rcrsr/rill-ext-fetch"
    },
    "config": {
      "api": {
        "baseUrl": "https://api.example.com",
        "endpoints": {
          "getUser": {
            "method": "GET",
            "path": "/users/:id",
            "params": [
              { "name": "id", "type": "string", "location": "path" }
            ]
          }
        }
      }
    }
  }
}
```

**app.rill**

```rill
use<ext:api> => $api

$api.getUser("123") -> log
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/extension-fetch.md) for configuration, functions, retry logic, and error handling.

## License

MIT
