# Capabilities — google-workspace Extension

This document covers the capability matrix, default-deny rationale, and allowlist/denylist semantics for the Google Workspace extension.

## Contents

- [Capability Matrix](#capability-matrix)
- [Default-Deny Rationale](#default-deny-rationale)
- [Enabling Write Capabilities](#enabling-write-capabilities)
- [Allowlist and Denylist Semantics](#allowlist-and-denylist-semantics)
- [Capability Gate Ordering](#capability-gate-ordering)

## Capability Matrix

Capabilities control which host functions the extension accepts at runtime. A disabled capability causes an immediate `RILL-R004` error before any network call.

### Gmail Capabilities

| Capability | Default | Affects Functions |
|------------|---------|-------------------|
| `gmail.read` | `true` | `gmail_search`, `gmail_read` |
| `gmail.search` | `true` | `gmail_search` |
| `gmail.draft` | `true` | `gmail_draft` |
| `gmail.label` | `true` | `gmail_label` |
| `gmail.send` | `false` | `gmail_send` |
| `gmail.reply` | `false` | `gmail_reply` |
| `gmail.modify` | `false` | `gmail_flag` |

### Drive Capabilities

| Capability | Default | Affects Functions |
|------------|---------|-------------------|
| `drive.read` | `true` | `drive_get_metadata` |
| `drive.list` | `true` | `drive_list` |
| `drive.download` | `true` | `drive_download` |
| `drive.upload` | `false` | `drive_upload` |
| `drive.share` | `false` | `drive_share` |
| `drive.delete` | `false` | `drive_delete` |

### Calendar Capabilities

| Capability | Default | Affects Functions |
|------------|---------|-------------------|
| `calendar.read` | `true` | `calendar_events`, `calendar_today` |
| `calendar.freeBusy` | `true` | `calendar_free_busy` |
| `calendar.create` | `false` | `calendar_create_event` |
| `calendar.update` | `false` | (reserved for future use) |
| `calendar.delete` | `false` | (reserved for future use) |

## Default-Deny Rationale

Write operations default to `false` across all three services. This design prevents accidental data mutation when an extension config is reused or copied.

Read operations default to `true` because read access carries lower risk and is the common case. A script that only reads data works without any capability configuration.

The following operations are write operations and default to `false`:

- **Gmail:** `send`, `reply`, `modify` (flagging). Drafts are excluded because a draft does not deliver to a recipient.
- **Drive:** `upload`, `share`, `delete`. These can create, expose, or destroy files.
- **Calendar:** `create`, `update`, `delete`. These modify calendar state.

Scripts that need write access must explicitly opt in via `capabilities` config. This makes the intent visible in the configuration file.

## Enabling Write Capabilities

Enable only the capabilities your script requires. Use the narrowest set needed.

**Enable Gmail send and reply:**

```json
{
  "capabilities": {
    "gmail": {
      "send": true,
      "reply": true
    }
  }
}
```

**Enable Drive upload only:**

```json
{
  "capabilities": {
    "drive": {
      "upload": true
    }
  }
}
```

**Enable Calendar event creation:**

```json
{
  "capabilities": {
    "calendar": {
      "create": true
    }
  }
}
```

**Disable a default-true capability** (e.g., restrict to search-only Gmail):

```json
{
  "capabilities": {
    "gmail": {
      "read": false,
      "draft": false,
      "label": false
    }
  }
}
```

Omitted capabilities retain their defaults. Partial overrides merge with defaults field by field.

## Allowlist and Denylist Semantics

Beyond capability flags, each service supports allowlists and denylists that constrain which resources a script can access. These checks run after capability gates and before the API call.

### Gmail Label Allowlist and Denylist

Configure via `gmail.allowedLabels` and `gmail.deniedLabels`.

| Setting | Effect |
|---------|--------|
| `allowedLabels` absent | All labels accessible (no allowlist). |
| `allowedLabels` set | Only listed label names are permitted. Calling `gmail_label` with any other label throws `RILL-R004`. |
| `deniedLabels` | Listed label names are always blocked, even if `allowedLabels` is absent. Default: `[]`. |

The allowlist takes precedence. If `allowedLabels` is set, any label not in the list is blocked regardless of `deniedLabels`.

**Example — restrict to INBOX and SENT only:**

```json
{
  "gmail": {
    "allowedLabels": ["INBOX", "SENT"]
  }
}
```

**Example — block SPAM label while leaving all others accessible:**

```json
{
  "gmail": {
    "deniedLabels": ["SPAM"]
  }
}
```

### Drive Folder Allowlist

Configure via `drive.allowedFolderIds`.

| Setting | Effect |
|---------|--------|
| `allowedFolderIds` absent | All folders accessible (no allowlist). |
| `allowedFolderIds` set | Only listed folder IDs are permitted for listing and upload. Must be non-empty (an empty array is a config error). |

**Example — restrict uploads to a specific project folder:**

```json
{
  "drive": {
    "allowedFolderIds": ["1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs"]
  }
}
```

### Drive MIME Type Denylist

Configure via `drive.deniedMimeTypes`.

| Setting | Effect |
|---------|--------|
| `deniedMimeTypes` absent or `[]` | All MIME types permitted. |
| `deniedMimeTypes` set | Listed MIME types are blocked from upload and listing. |

**Example — block executable uploads:**

```json
{
  "drive": {
    "deniedMimeTypes": ["application/x-executable", "application/x-msdownload"]
  }
}
```

### Drive Upload Size Limit

Configure via `drive.maxUploadBytes`.

| Setting | Effect |
|---------|--------|
| `maxUploadBytes` absent | No size limit. |
| `maxUploadBytes` set | Files exceeding the limit throw `RILL-R004` before the upload request. Must be a positive integer. |

**Example — limit uploads to 10 MB:**

```json
{
  "drive": {
    "maxUploadBytes": 10485760
  }
}
```

### Calendar ID Allowlist

Configure via `calendar.allowedCalendarIds`.

| Setting | Effect |
|---------|--------|
| `allowedCalendarIds` absent | All calendars accessible. |
| `allowedCalendarIds` set | Only listed calendar IDs are permitted for reads and event creation. Must be non-empty. |

**Example — restrict to the primary calendar only:**

```json
{
  "calendar": {
    "allowedCalendarIds": ["primary"]
  }
}
```

### Calendar All-Day Event Restriction

Configure via `calendar.denyAllDay`.

| Setting | Effect |
|---------|--------|
| `denyAllDay: false` (default) | All-day events included in results and creation is permitted. |
| `denyAllDay: true` | All-day events excluded from `calendar_events` and `calendar_today` results; `calendar_create_event` throws `RILL-R004` for all-day events. |

## Capability Gate Ordering

The extension evaluates gates in this order for every call:

1. **Disposal check** — throws `google: operation cancelled` if `dispose()` was called.
2. **Capability gate** — throws `google: <service>.<capability> not enabled` if the flag is `false`.
3. **Allowlist/denylist check** — throws the relevant label, folder, MIME type, or calendar error.
4. **Token resolution** — resolves the bearer token from config or RuntimeContext.
5. **Network call** — sends the HTTP request to the Google API.

This ordering means capability errors are fast and produce no network traffic. Token values are never touched for disabled capabilities.
