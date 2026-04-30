# outlook Extension

*Microsoft Outlook mail and calendar integration for rill scripts via the Graph API*

## Contents

- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Functions](#functions)
- [Message Dict Shape](#message-dict-shape)
- [Error Behavior](#error-behavior)
- [Events](#events)
- [See Also](#see-also)

Provides 12 host functions covering mail read, mail write, calendar read, and calendar write operations. All requests go to `https://graph.microsoft.com/v1.0` using native `fetch`. The extension manages in-flight request tracking, capability gating, and clean disposal.

Use this extension when your script needs to read or send Outlook mail, query calendar events, or check free/busy availability.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "outlook": "@rcrsr/rill-ext-outlook"
    },
    "config": {
      "outlook": {
        "auth": {
          "type": "bearer",
          "token": "${OUTLOOK_TOKEN}"
        }
      }
    }
  }
}
```

Rill script — load the extension as a handle and call functions via dot-path:

```rill
use<ext:outlook> => $mail
$mail.inbox() => $result
$result.messages -> log
```

Call a function directly without an intermediate variable:

```rill
use<ext:outlook.inbox>() => $result
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "outlook": {
        "auth": {
          "type": "bearer",
          "token": "${OUTLOOK_TOKEN}"
        },
        "capabilities": {
          "mail": { "send": true },
          "calendar": { "create": true }
        },
        "mail": {
          "maxResults": 25,
          "folders": ["inbox", "sentitems"]
        },
        "mailbox": "shared@example.com"
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `auth` | object | — | Authentication configuration (required). |
| `auth.type` | string | — | `"bearer"` or `"session"` (required). |
| `auth.token` | string | — | Static Bearer token. Required when `auth.type` is `"bearer"`. |
| `auth.tokenVar` | string | — | RuntimeContext variable name holding the token. Required when `auth.type` is `"session"`. |
| `capabilities` | object | See defaults below | Operation permission flags. Partial overrides merged with defaults. |
| `capabilities.mail.read` | boolean | `true` | Allow inbox, from, read, and search operations. |
| `capabilities.mail.send` | boolean | `false` | Allow send and reply operations. |
| `capabilities.mail.draft` | boolean | `true` | Allow draft operations. |
| `capabilities.mail.flag` | boolean | `true` | Allow flag operations. |
| `capabilities.mail.search` | boolean | `true` | Allow search operations. |
| `capabilities.calendar.read` | boolean | `true` | Allow events, today, and free_busy operations. |
| `capabilities.calendar.create` | boolean | `false` | Allow create_event operations. |
| `mail.maxResults` | number | `50` | Maximum messages returned per query. Range: 1-1000. |
| `mail.folders` | string[] | `["inbox"]` | Allowlist of accessible folder names. |
| `mailbox` | string | — | Shared mailbox UPN or user ID. When absent, uses `/me/` endpoint. |

### Authentication Modes

**Bearer mode** — supply a static token directly:

```json
{ "auth": { "type": "bearer", "token": "${OUTLOOK_TOKEN}" } }
```

**Session mode** — read the token from a RuntimeContext variable at call time:

```json
{ "auth": { "type": "session", "tokenVar": "user_token" } }
```

Session mode supports per-user tokens in multi-tenant scripts. The variable is resolved from the RuntimeContext chain at each call.

### Default Capabilities

| Capability | Default |
|------------|---------|
| `mail.read` | `true` |
| `mail.send` | `false` |
| `mail.draft` | `true` |
| `mail.flag` | `true` |
| `mail.search` | `true` |
| `calendar.read` | `true` |
| `calendar.create` | `false` |

Write operations (`send`, `reply`, `create_event`) are disabled by default. Enable them explicitly when needed.

## Functions

### Mail — Read

#### inbox

List messages from the configured folder, ordered by received date descending.

```rill
$mail.inbox() => $result
$result.messages -> log
```

With options:

```rill
$mail.inbox([top: 10, unread: true]) => $result
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `top` | number | `maxResults` | Number of messages to return. Capped at `maxResults`. |
| `unread` | boolean | — | When `true`, returns only unread messages. |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `messages` | list | List of message dicts. See message shape below. |

#### from

List messages from a specific sender address.

```rill
$mail.from("alice@example.com") => $result
$result.messages -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `address` | string | — | Sender email address to filter by (required). |
| `top` | number | `maxResults` | Number of messages to return. Capped at `maxResults`. |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `messages` | list | List of message dicts. |

#### read

Fetch a single message by ID with full body content.

```rill
$mail.read("AAMkAGI2...") => $message
$message.body -> log
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message_id` | string | Graph API message ID (required). |

**Result Dict:** Single message dict (see shape below).

#### search

Search messages using a keyword query string.

```rill
$mail.search("budget report") => $result
$result.messages -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | — | Search keyword string (required). |
| `top` | number | `maxResults` | Number of messages to return. Capped at `maxResults`. |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `messages` | list | List of message dicts. |
| `query` | string | The query string used. |

### Mail — Write

#### send

Send an email message.

```rill
$mail.send(["bob@example.com"], "Hello", "Message body") => $result
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `to` | list | List of recipient email addresses (required). Single string auto-wrapped. |
| `subject` | string | Message subject (required). |
| `body` | string | Message body as plain text (required). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `sent` | boolean | Always `true` when successful. |
| `to` | list | Resolved recipient list. |
| `subject` | string | Message subject sent. |

#### reply

Reply to an existing message.

```rill
$mail.reply("AAMkAGI2...", "Thanks for the update.") => $result
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message_id` | string | ID of the message to reply to (required). |
| `body` | string | Reply body as plain text (required). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `sent` | boolean | Always `true` when successful. |
| `to` | list | Always empty (`[]`). Graph API returns HTTP 202 with no response body, so no recipient data is available. |
| `subject` | string | Always empty (`''`). Graph API returns HTTP 202 with no response body, so no subject data is available. |

#### draft

Create a draft message without sending.

```rill
$mail.draft(["bob@example.com"], "Draft subject", "Draft body") => $draft
$draft.id -> log
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `to` | list | List of recipient email addresses (required). Single string auto-wrapped. |
| `subject` | string | Message subject (required). |
| `body` | string | Message body as plain text (required). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Graph API ID of the created draft. |
| `to` | list | Recipient list. |
| `subject` | string | Draft subject. |

#### flag

Set the follow-up flag on a message.

```rill
$mail.flag("AAMkAGI2...") => $result
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message_id` | string | ID of the message to flag (required). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Message ID that was flagged. |
| `flagged` | boolean | Always `true` when successful. |

### Calendar — Read

#### events

List calendar events within a time range.

```rill
$mail.events(1743897600000, 1743984000000) => $result
$result.events -> log
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `start` | number | Start of range as epoch milliseconds (required). |
| `end` | number | End of range as epoch milliseconds (required). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `events` | list | List of calendar event dicts. |
| `range` | string | ISO 8601 interval string (`start/end`). |

#### today

List all calendar events scheduled for today.

```rill
$mail.today() => $result
$result.events -> log
```

No parameters.

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `events` | list | List of today's calendar event dicts. |

#### free_busy

Check free/busy availability for a list of attendees.

```rill
$mail.free_busy(1743897600000, 1743984000000, ["alice@example.com"]) => $result
$result.schedules -> log
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `start` | number | Start of range as epoch milliseconds (required). |
| `end` | number | End of range as epoch milliseconds (required). |
| `attendees` | list | List of email addresses to check availability for (required). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `schedules` | list | List of schedule availability dicts per attendee. |
| `range` | string | ISO 8601 interval string (`start/end`). |

### Calendar — Write

#### create_event

Create a new calendar event.

```rill
$mail.create_event("Team Sync", 1743897600000, 1743901200000, [location: "Conference Room A"]) => $result
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `title` | string | Event subject/title (required). |
| `start` | number | Start time as epoch milliseconds (required). |
| `end` | number | End time as epoch milliseconds (required). |
| `options` | dict | Optional event fields (see below). |

**Options Dict:**

| Option | Type | Description |
|--------|------|-------------|
| `location` | string | Event location display name. |
| `attendees` | list | List of attendee email addresses. |
| `isOnline` | boolean | When `true`, creates an online meeting link. |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Graph API ID of the created event. |
| `title` | string | Event subject. |
| `start` | number | Start time as epoch milliseconds. |
| `end` | number | End time as epoch milliseconds. |

### Message Dict Shape

All mail read functions return message dicts with this shape:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Graph API message ID. |
| `subject` | string | Message subject. |
| `preview` | string | Short body preview text. |
| `from` | string | Sender email address. |
| `to` | list | List of recipient email addresses. |
| `date` | number | Received timestamp as epoch milliseconds. |
| `unread` | boolean | Whether the message has not been read. |
| `flagged` | boolean | Whether the message is flagged for follow-up. |
| `hasAttachments` | boolean | Whether the message has attachments. |

## Error Behavior

The extension emits failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #AUTH`) or finely
(`guard #AUTH && raw.kind == 'authentication_failed'`).

`meta.provider == 'outlook'` on every host-fn failure.

**Factory-time validation** (throws `RuntimeError RILL-R001`):

- `outlook: auth is required` — missing `auth` config
- `outlook: auth.type must be 'bearer' or 'session'`
- `outlook: auth.token is required` — bearer mode missing token
- `outlook: auth.tokenVar is required` — session mode missing tokenVar
- `outlook: maxResults must be 1-1000` — `maxResults` out of range
- `outlook: folders must be non-empty` — empty folders array

**Host-fn errors:**

| Failure | Atom | `meta.raw.kind` |
|---|---|---|
| Session token variable not found | `#AUTH` | `session_token_missing` |
| Capability disabled in config | `#FORBIDDEN` | `capability_disabled` |
| Empty `to` / `subject` / `body` / required field | `#INVALID_INPUT` | `invalid_input` |
| `start` after `end` on events / `free_busy` | `#INVALID_INPUT` | `invalid_input` |
| Authentication failed (HTTP 401) | `#AUTH` | `authentication_failed` |
| Insufficient permissions for operation (HTTP 403) | `#FORBIDDEN` | `forbidden` |
| Message / resource not found (HTTP 404) | `#NOT_FOUND` | `not_found` |
| Rate limit exceeded (HTTP 429) | `#RATE_LIMIT` | `rate_limit_exceeded` |
| Server error (HTTP 5xx) | `#UNAVAILABLE` | `server_error` |
| Request timeout / abort | `#TIMEOUT` | `request_timeout` |
| Cooperative cancellation via `ctx.signal` | `#TIMEOUT` | `request_cancelled` |
| Network connection failure (`TypeError`) | `#UNAVAILABLE` | `connection_failed` |
| Unexpected response format (`SyntaxError`) | `#PROTOCOL` | `unexpected_response_format` |
| Called after `dispose()` | `#DISPOSED` | `disposed` |
| Other Graph API / unknown failure | `#UNAVAILABLE` | `unknown_error` |

## Events

The extension emits runtime events for observability. Listen with `ctx.on()` in the host application.

**Mail events:**

| Event | Fields |
|-------|--------|
| `outlook:mail:read` | `duration` (ms), `folder` (string), `message_count` (number) |
| `outlook:mail:search` | `duration` (ms), `query` (string), `result_count` (number) |
| `outlook:mail:send` | `duration` (ms), `to` (string), `subject` (string) |
| `outlook:mail:draft` | `duration` (ms), `to` (string), `subject` (string) |
| `outlook:mail:flag` | `duration` (ms), `message_id` (string) |

**Calendar events:**

| Event | Fields |
|-------|--------|
| `outlook:calendar:read` | `duration` (ms), `event_count` (number), `range` (string) |
| `outlook:calendar:create` | `duration` (ms), `title` (string) |

**Error events** (emitted when any request fails):

| Event | Fields |
|-------|--------|
| `outlook:error` | `duration` (ms), `error` (string) |

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
- [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/api/overview) — Underlying API reference
