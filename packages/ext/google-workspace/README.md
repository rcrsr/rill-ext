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

## Authentication

Four auth modes are supported. Pick one based on the deployment context:

| Mode | When to use |
|------|-------------|
| `bearer` | Static OAuth access token. Scripts, CI, local development. |
| `session` | Bearer token resolved per call from `RuntimeContext`. Multi-tenant web apps. |
| `service-account` | GCP service account JSON key, optional domain-wide delegation. Server automation. |
| `oauth-refresh` | OAuth client ID/secret plus long-lived refresh token, auto-exchanged for access tokens. Desktop apps, personal Gmail/Drive/Calendar. |

Required fields for each mode and full setup steps live in [docs/auth.md](docs/auth.md).

## Documentation

- [docs/README.md](docs/README.md) — configuration, all 17 host functions, response dict shapes, events.
- [docs/auth.md](docs/auth.md) — auth variant comparison, GCP setup, domain-wide delegation.
- [docs/capabilities.md](docs/capabilities.md) — capability matrix and default-deny rationale.
- [docs/errors.md](docs/errors.md) — generic-atom error catalog and retry guidance.

Host function response dict shapes (Gmail, Drive, Calendar) are documented in `docs/README.md` under each function entry. The TypeScript declarations expose callables as opaque `ApplicationCallable`; the response-shape reference is the markdown documentation.

## License

MIT
