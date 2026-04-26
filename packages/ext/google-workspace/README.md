# @rcrsr/rill-ext-google-workspace

[rill](https://rill.run) extension for Google Workspace (Gmail, Drive, Calendar) via the Google REST API. Provides 17 host functions: `gmail_search`, `gmail_read`, `gmail_send`, `gmail_draft`, `gmail_reply`, `gmail_flag`, `gmail_label`, `drive_list`, `drive_upload`, `drive_download`, `drive_share`, `drive_delete`, `drive_get_metadata`, `calendar_events`, `calendar_today`, `calendar_create_event`, and `calendar_free_busy`.

## Install

```bash
npm install @rcrsr/rill-ext-google-workspace
```

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "gws": "@rcrsr/rill-ext-google-workspace"
    },
    "config": {
      "gws": {
        "auth": {
          "type": "bearer",
          "token": "${GOOGLE_TOKEN}"
        }
      }
    }
  }
}
```

**app.rill**

```rill
use<ext:gws> => $gws

$gws.gmail_search({ query: "is:unread" }) => $result
$result.messages -> each { log }
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/README.md) for configuration, authentication modes, functions, error handling, and events.

## License

MIT
