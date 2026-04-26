# google-workspace Extension

*Gmail, Google Drive, and Google Calendar integration for rill scripts via the Google REST API*

## Contents

- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Functions](#functions)
- [Error Behavior](#error-behavior)
- [Events](#events)
- [See Also](#see-also)

Provides 17 host functions covering Gmail read/write, Drive file management, and Calendar events.
All requests go to `https://www.googleapis.com` using native `fetch`.
The extension manages in-flight request tracking, capability gating, and clean disposal.

Use this extension when your script needs to read or send Gmail, manage Drive files, or query Calendar events.

## Quick Start

**Provision credentials:** use the [Google Workspace CLI](https://github.com/googleworkspace/cli) to create a GCP project, enable APIs, and obtain a token or service account key.

```bash
gws auth setup    # one-time project + OAuth client setup
gws auth login    # OAuth consent flow, prints an access token
```

See [auth.md](auth.md) for full details on all three auth variants.

**Bearer token (static OAuth token):**

```json
{
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

**Session token (per-call from RuntimeContext):**

```json
{
  "extensions": {
    "config": {
      "gws": {
        "auth": {
          "type": "session",
          "tokenVar": "user_google_token"
        }
      }
    }
  }
}
```

**Service account (server-to-server, with optional impersonation):**

```json
{
  "extensions": {
    "config": {
      "gws": {
        "auth": {
          "type": "service-account",
          "keyJson": "${GOOGLE_SERVICE_ACCOUNT_JSON}",
          "subject": "user@yourdomain.com"
        }
      }
    }
  }
}
```

`subject` enables domain-wide delegation. Omit it to act as the service account itself.

Rill script — load the extension handle and call functions via dot-path:

```rill
use<ext:gws> => $gws
$gws.gmail_search("from:boss@example.com is:unread") => $result
$result.messages -> log
```

Call a function directly without an intermediate variable:

```rill
use<ext:gws.calendar_today>() => $today
$today.events -> log
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "gws": {
        "auth": {
          "type": "bearer",
          "token": "${GOOGLE_TOKEN}"
        },
        "capabilities": {
          "gmail": { "send": true, "reply": true },
          "drive": { "upload": true },
          "calendar": { "create": true }
        },
        "gmail": {
          "maxResults": 25,
          "allowedLabels": ["INBOX", "SENT"],
          "deniedLabels": ["SPAM"]
        },
        "drive": {
          "allowedFolderIds": ["1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs"],
          "deniedMimeTypes": ["application/x-executable"],
          "maxUploadBytes": 10485760
        },
        "calendar": {
          "allowedCalendarIds": ["primary"],
          "denyAllDay": false
        }
      }
    }
  }
}
```

### Top-Level Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `auth` | object | — | Authentication configuration (required). |
| `auth.type` | string | — | `"bearer"`, `"session"`, or `"service-account"` (required). |
| `auth.token` | string | — | Static Bearer token. Required when `auth.type` is `"bearer"`. |
| `auth.tokenVar` | string | — | RuntimeContext variable name holding the Bearer token. Required when `auth.type` is `"session"`. |
| `auth.keyJson` | string | — | GCP service account key JSON string. Required when `auth.type` is `"service-account"`. |
| `auth.subject` | string | — | Email to impersonate via domain-wide delegation. Optional; `service-account` only. |
| `capabilities` | object | See defaults | Operation permission flags. Partial overrides merged with defaults. |
| `gmail` | object | — | Gmail query constraints (optional). |
| `drive` | object | — | Drive query constraints (optional). |
| `calendar` | object | — | Calendar query constraints (optional). |

### Gmail Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `gmail.maxResults` | number | `50` | Maximum messages returned per query. Range: 1-500. |
| `gmail.allowedLabels` | string[] | — | When set, only these label names are accessible. |
| `gmail.deniedLabels` | string[] | `[]` | Label names that callers cannot access. |

### Drive Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `drive.allowedFolderIds` | string[] | — | When set, only files in these folder IDs are accessible. Must be non-empty if provided. |
| `drive.deniedMimeTypes` | string[] | `[]` | MIME types excluded from upload and listing. |
| `drive.maxUploadBytes` | number | — | Maximum upload size in bytes. No limit when absent. Must be positive. |

### Calendar Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `calendar.allowedCalendarIds` | string[] | — | When set, only these calendar IDs are accessible. Must be non-empty if provided. |
| `calendar.denyAllDay` | boolean | `false` | When `true`, all-day events are excluded from results and creation is blocked. |

For capability defaults and the default-deny rationale, see [capabilities.md](./capabilities.md).
For auth variant comparison and GCP setup, see [auth.md](./auth.md).

## Functions

### Gmail

#### gmail_search

Search Gmail messages using a Gmail query string.

```rill
$gws.gmail_search("from:alice@example.com is:unread") => $result
$result.messages -> log
```

With options:

```rill
$gws.gmail_search("label:INBOX", [maxResults: 10]) => $result
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | — | Gmail query string, e.g. `"from:bob subject:invoice"` (required). |
| `options` | dict | `{}` | Optional overrides: `maxResults` (number). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `messages` | list | List of message summary dicts. Each has `id`, `threadId`, `snippet`. |
| `count` | number | Number of messages returned. |

Requires capability: `gmail.read` and `gmail.search` (both default `true`).

---

#### gmail_read

Fetch a single Gmail message by ID with full body content.

```rill
$gws.gmail_read("17abc123def456") => $message
$message.body -> log
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `messageId` | string | Gmail message ID (required). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Gmail message ID. |
| `threadId` | string | Thread ID. |
| `subject` | string | Message subject. |
| `from` | string | Sender email address. |
| `to` | string | Primary recipient email address. |
| `date` | string | Message date as ISO 8601 string. |
| `body` | string | Decoded message body (plain text preferred). |
| `snippet` | string | Short preview excerpt. |
| `labels` | list | List of label name strings. |

Requires capability: `gmail.read` (default `true`).

---

#### gmail_send

Send a Gmail message.

```rill
$gws.gmail_send("bob@example.com", "Hello", "Message body") => $messageId
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `to` | string | — | Recipient email address (required). |
| `subject` | string | — | Message subject (required). |
| `body` | string | — | Message body as plain text (required). |
| `options` | dict | `{}` | Optional: `cc` (string), `bcc` (string). |

Returns the sent message ID as a string.

Requires capability: `gmail.send` (default `false` — must be explicitly enabled).

---

#### gmail_draft

Create a Gmail draft without sending.

```rill
$gws.gmail_draft("bob@example.com", "Draft subject", "Draft body") => $draftId
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `to` | string | — | Recipient email address (required). |
| `subject` | string | — | Message subject (required). |
| `body` | string | — | Message body as plain text (required). |
| `options` | dict | `{}` | Optional: `cc` (string), `bcc` (string). |

Returns the created draft ID as a string.

Requires capability: `gmail.draft` (default `true`).

---

#### gmail_reply

Reply to an existing Gmail message.

```rill
$gws.gmail_reply("17abc123def456", "Thanks for the update.") => $messageId
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `messageId` | string | — | ID of the message to reply to (required). |
| `body` | string | — | Reply body as plain text (required). |
| `options` | dict | `{}` | Optional: `cc` (string), `bcc` (string). |

Returns the sent reply message ID as a string.

Requires capability: `gmail.reply` (default `false` — must be explicitly enabled).

---

#### gmail_flag

Star or unstar a Gmail message.

```rill
$gws.gmail_flag("17abc123def456", true) => $ok
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `messageId` | string | Gmail message ID (required). |
| `flagged` | boolean | `true` to star; `false` to unstar (required). |

Returns `true` on success.

Requires capability: `gmail.modify` (default `false` — must be explicitly enabled).

---

#### gmail_label

Apply a label to a Gmail message.

```rill
$gws.gmail_label("17abc123def456", "INBOX") => $ok
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `messageId` | string | Gmail message ID (required). |
| `labelName` | string | Name of the label to apply (required). |

Returns `true` on success. Subject to `allowedLabels` and `deniedLabels` enforcement.

Requires capability: `gmail.label` (default `true`).

---

### Drive

#### drive_list

List files in Google Drive, optionally scoped to a folder.

```rill
$gws.drive_list() => $result
$result.files -> log
```

With a folder ID:

```rill
$gws.drive_list("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs") => $result
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `folderId` | string | — | Folder ID to scope listing (optional). |
| `options` | dict | `{}` | Optional: `pageSize` (number), `query` (string). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `files` | list | List of file metadata dicts. Each has `id`, `name`, `mimeType`, `size`, `modifiedTime`. |
| `count` | number | Number of files returned. |

Requires capability: `drive.list` (default `true`).

---

#### drive_upload

Upload content as a file to Google Drive.

```rill
$gws.drive_upload("Hello, world!", "hello.txt") => $result
$result.id -> log
```

To a specific folder:

```rill
$gws.drive_upload($content, "report.csv", "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs") => $result
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `content` | string | — | File content as a string (required). |
| `filename` | string | — | Name of the file to create (required). |
| `folderId` | string | — | Parent folder ID (optional). Uses Drive root when absent. |
| `options` | dict | `{}` | Optional: `mimeType` (string). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Drive file ID of the created file. |
| `name` | string | File name. |
| `mimeType` | string | MIME type of the created file. |

Requires capability: `drive.upload` (default `false` — must be explicitly enabled).

---

#### drive_download

Download a Drive file's content as a string.

```rill
$gws.drive_download("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs") => $content
$content -> log
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `fileId` | string | Drive file ID (required). |

Returns the file content as a string.

Requires capability: `drive.download` (default `true`).

---

#### drive_share

Share a Drive file with a user.

```rill
$gws.drive_share("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs", "alice@example.com", "writer") => $ok
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `fileId` | string | — | Drive file ID (required). |
| `email` | string | — | Email address of the user to share with (required). |
| `role` | string | `"reader"` | Permission role: `"reader"`, `"commenter"`, or `"writer"`. |

Returns `true` on success.

Requires capability: `drive.share` (default `false` — must be explicitly enabled).

---

#### drive_delete

Permanently delete a Drive file.

```rill
$gws.drive_delete("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs") => $ok
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `fileId` | string | Drive file ID (required). |

Returns `true` on success. This operation is irreversible.

Requires capability: `drive.delete` (default `false` — must be explicitly enabled).

---

#### drive_get_metadata

Fetch metadata for a Drive file without downloading its content.

```rill
$gws.drive_get_metadata("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs") => $meta
$meta.name -> log
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `fileId` | string | Drive file ID (required). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Drive file ID. |
| `name` | string | File name. |
| `mimeType` | string | MIME type. |
| `size` | number | File size in bytes. |
| `createdTime` | string | Creation timestamp as ISO 8601 string. |
| `modifiedTime` | string | Last modification timestamp as ISO 8601 string. |
| `webViewLink` | string | URL to view the file in a browser. |

Requires capability: `drive.read` (default `true`).

---

### Calendar

#### calendar_events

List Google Calendar events within a date range.

```rill
$gws.calendar_events("2026-04-01T00:00:00Z", "2026-04-30T23:59:59Z") => $result
$result.events -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startDate` | string | — | Start of range as ISO 8601 with timezone (required). |
| `endDate` | string | — | End of range as ISO 8601 with timezone (required). |
| `options` | dict | `{}` | Optional: `calendarId` (string, default `"primary"`), `maxResults` (number). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `events` | list | List of calendar event dicts. Each has `id`, `title`, `start`, `end`, `location`, `attendees`. |
| `count` | number | Number of events returned. |

Requires capability: `calendar.read` (default `true`).

---

#### calendar_today

List all calendar events scheduled for today.

```rill
$gws.calendar_today() => $result
$result.events -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options` | dict | `{}` | Optional: `calendarId` (string, default `"primary"`). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `events` | list | List of today's calendar event dicts. |
| `count` | number | Number of events returned. |

Requires capability: `calendar.read` (default `true`).

---

#### calendar_create_event

Create a new Google Calendar event.

```rill
$gws.calendar_create_event(
  "Team Sync",
  "2026-04-26T14:00:00Z",
  "2026-04-26T15:00:00Z"
) => $eventId
```

With options:

```rill
$gws.calendar_create_event(
  "All Hands",
  "2026-04-26T10:00:00Z",
  "2026-04-26T11:00:00Z",
  [location: "Conference Room A", attendees: ["alice@example.com", "bob@example.com"]]
) => $eventId
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `title` | string | — | Event title (required). |
| `startTime` | string | — | Start time as ISO 8601 with timezone (required). |
| `endTime` | string | — | End time as ISO 8601 with timezone (required). |
| `options` | dict | `{}` | Optional: `calendarId` (string), `location` (string), `attendees` (list of strings), `description` (string). |

Returns the created event ID as a string.

Requires capability: `calendar.create` (default `false` — must be explicitly enabled).

---

#### calendar_free_busy

Query free/busy availability for a list of users.

```rill
$gws.calendar_free_busy(
  ["alice@example.com", "bob@example.com"],
  "2026-04-26T09:00:00Z",
  "2026-04-26T17:00:00Z"
) => $result
$result.schedules -> log
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `emails` | list | List of email addresses to check (required). |
| `startTime` | string | Start of range as ISO 8601 with timezone (required). |
| `endTime` | string | End of range as ISO 8601 with timezone (required). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `schedules` | dict | Map of email address to availability dict. Each availability dict has `busy` (list of `{start, end}` intervals). |

Requires capability: `calendar.freeBusy` (default `true`).

## Error Behavior

See [errors.md](./errors.md) for the complete RILL-R004 error catalog and retry guidance.

## Events

The extension emits runtime events for observability. Listen with `ctx.on()` in the host application.
Every successful callable emits one event in the form `google:<service>:<operation>`.

**Gmail events:**

| Event | Fields |
|-------|--------|
| `google:gmail:search` | `duration` (ms) |
| `google:gmail:read` | `duration` (ms) |
| `google:gmail:send` | `duration` (ms) |
| `google:gmail:draft` | `duration` (ms) |
| `google:gmail:reply` | `duration` (ms) |
| `google:gmail:flag` | `duration` (ms) |
| `google:gmail:label` | `duration` (ms) |

**Drive events:**

| Event | Fields |
|-------|--------|
| `google:drive:list` | `duration` (ms) |
| `google:drive:upload` | `duration` (ms) |
| `google:drive:download` | `duration` (ms) |
| `google:drive:share` | `duration` (ms) |
| `google:drive:delete` | `duration` (ms) |
| `google:drive:get_metadata` | `duration` (ms) |

**Calendar events:**

| Event | Fields |
|-------|--------|
| `google:calendar:events` | `duration` (ms) |
| `google:calendar:today` | `duration` (ms) |
| `google:calendar:create_event` | `duration` (ms) |
| `google:calendar:free_busy` | `duration` (ms) |

## See Also

- [auth.md](./auth.md) — Auth variant comparison, GCP service account setup, domain-wide delegation
- [capabilities.md](./capabilities.md) — Capability matrix, default-deny rationale, allowlist semantics
- [errors.md](./errors.md) — RILL-R004 error catalog, retry guidance
- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Google APIs](https://developers.google.com/apis-explorer) — Underlying API reference
