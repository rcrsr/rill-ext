# @rcrsr/rill-ext-outlook

[rill](https://rill.run) extension for Microsoft Outlook via the Graph API. Provides `inbox`, `from`, `search`, `read`, `send`, `draft`, `reply`, `flag`, `events`, `today`, `free_busy`, and `create_event` host functions.

## Install

```bash
npm install @rcrsr/rill-ext-outlook
```

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "mail": "@rcrsr/rill-ext-outlook"
    },
    "config": {
      "mail": {
        "auth": {
          "type": "bearer",
          "token": "${OUTLOOK_TOKEN}"
        }
      }
    }
  }
}
```

**app.rill**

```rill
use<ext:mail> => $mail

$mail.inbox() => $result
$result.messages -> each { log }
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/extension-outlook.md) for configuration, functions, error handling, and events.

## License

MIT
