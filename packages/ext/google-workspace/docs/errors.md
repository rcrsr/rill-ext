# Error Reference — google-workspace Extension

The extension emits failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #AUTH`) or finely
(`guard #AUTH && raw.kind == 'authentication_failed'`).

`meta.provider == 'google'` on every host-fn failure. Every diagnostic message begins with the `google:` prefix.

## Contents

- [Factory Validation Errors](#factory-validation-errors)
- [Capability Gate Errors](#capability-gate-errors)
- [Label Errors (Gmail)](#label-errors-gmail)
- [Folder and File Errors (Drive)](#folder-and-file-errors-drive)
- [Calendar Constraint Errors](#calendar-constraint-errors)
- [HTTP Errors](#http-errors)
- [Network and Lifecycle Errors](#network-and-lifecycle-errors)
- [Retry Guidance](#retry-guidance)

## Factory Validation Errors

These conditions throw `RuntimeError RILL-R001` at extension creation time, before any host function is callable.

| Condition | Message |
|-----------|---------|
| `auth` field absent or falsy | `google: auth is required` |
| `auth.type` is not a valid variant | `google: auth.type must be 'bearer', 'session', or 'service-account'` |
| Bearer mode: `auth.token` absent or empty | `google: auth.token is required` |
| Session mode: `auth.tokenVar` absent or empty | `google: auth.tokenVar is required` |
| Service account: `auth.keyJson` is not valid JSON | `google: auth.keyJson is invalid: not valid JSON` |
| Service account: `auth.keyJson` missing `client_email` | `google: auth.keyJson is invalid: missing field 'client_email'` |
| Service account: `auth.keyJson` missing `private_key` | `google: auth.keyJson is invalid: missing field 'private_key'` |
| Service account: `auth.keyJson` missing `token_uri` | `google: auth.keyJson is invalid: missing field 'token_uri'` |
| `gmail.maxResults` outside 1-500 | `google: gmail.maxResults must be 1-500` |
| `drive.maxUploadBytes` is zero or negative | `google: drive.maxUploadBytes must be positive` |
| `drive.allowedFolderIds` is an empty array | `google: drive.allowedFolderIds must be non-empty` |
| `calendar.allowedCalendarIds` is an empty array | `google: calendar.allowedCalendarIds must be non-empty` |

## Capability Gate Errors

These errors return invalid `#FORBIDDEN` values at call time when the required capability flag is `false`. The gate runs before token resolution; no network traffic occurs.

| Capability Checked | Atom | `meta.raw.kind` | Message |
|--------------------|------|---|---------|
| `gmail.read`, `gmail.search`, `gmail.send`, `gmail.draft`, `gmail.reply`, `gmail.label`, `gmail.modify` | `#FORBIDDEN` | `capability_disabled` | `google: gmail.<capability> not enabled` |
| `drive.read`, `drive.list`, `drive.upload`, `drive.download`, `drive.share`, `drive.delete` | `#FORBIDDEN` | `capability_disabled` | `google: drive.<capability> not enabled` |
| `calendar.read`, `calendar.freeBusy`, `calendar.create` | `#FORBIDDEN` | `capability_disabled` | `google: calendar.<capability> not enabled` |

## Label Errors (Gmail)

These errors return invalid values when `gmail_label` is called with a label name that violates an allowlist or denylist.

| Condition | Atom | `meta.raw.kind` | Message |
|-----------|------|---|---------|
| Label not in `allowedLabels` | `#FORBIDDEN` | `label_not_allowed` | `google: label '<name>' not in allowed set` |
| Label appears in `deniedLabels` | `#FORBIDDEN` | `label_denied` | `google: label '<name>' in denied set` |

Where `<name>` is the label name passed by the caller (e.g. `google: label 'SPAM' in denied set`).

## Folder and File Errors (Drive)

These errors return invalid values when a Drive call violates folder, MIME type, upload size, or role constraints.

| Condition | Atom | `meta.raw.kind` | Message |
|-----------|------|---|---------|
| Folder not in `allowedFolderIds` | `#FORBIDDEN` | `folder_not_allowed` | `google: folder '<id>' not in allowed set` |
| MIME type in `deniedMimeTypes` | `#FORBIDDEN` | `mime_type_denied` | `google: MIME type '<type>' not allowed` |
| Upload exceeds `maxUploadBytes` | `#INVALID_INPUT` | `upload_too_large` | `google: file exceeds maximum upload size (<n> bytes)` |
| `drive_share` role is not a valid value | `#INVALID_INPUT` | `invalid_input` | `google: drive.share role must be 'reader', 'commenter', or 'writer'` |

Where `<id>` is the folder ID, `<type>` is the MIME type string, and `<n>` is the configured `maxUploadBytes` value.

## Calendar Constraint Errors

These errors return invalid values when Calendar calls violate date format, all-day, or calendar ID constraints.

| Condition | Atom | `meta.raw.kind` | Message |
|-----------|------|---|---------|
| `start_date` / `end_date` not ISO 8601 with timezone | `#INVALID_INPUT` | `invalid_input` | `google: <field> must be ISO 8601 with timezone` |
| `start_time` / `end_time` not ISO 8601 with timezone | `#INVALID_INPUT` | `invalid_input` | `google: <field> must be ISO 8601 with timezone` |
| `denyAllDay: true` and event is all-day | `#FORBIDDEN` | `all_day_denied` | `google: all-day events not permitted` |
| Calendar ID not in `allowedCalendarIds` | `#FORBIDDEN` | `calendar_not_allowed` | `google: calendar '<id>' not in allowed set` |

Where `<field>` is the parameter name (e.g. `start_date`, `start_time`) and `<id>` is the calendar ID.

A naive ISO 8601 string without a timezone suffix (e.g. `"2026-04-26T09:00:00"` without `Z` or `+HH:MM`) is considered invalid.

## HTTP Errors

These errors return invalid values when the Google API returns a non-success HTTP status. `meta.raw.status` carries the numeric status code.

| HTTP Status | Atom | `meta.raw.kind` | Message Pattern |
|-------------|------|---|-----------------|
| 401 | `#AUTH` | `authentication_failed` | `google: invalid <Service> token` |
| 403 | `#FORBIDDEN` | `forbidden` | `google: insufficient <Service> scopes for <operation>` |
| 404 | `#NOT_FOUND` | `not_found` | `google: <Service> resource '<id>' not found` |
| 429 | `#RATE_LIMIT` | `rate_limit_exceeded` | `google: rate limit exceeded; retry after delay` |
| 402 | `#QUOTA_EXCEEDED` | `quota_exceeded` | `google: <Service> quota exceeded` |
| 5xx | `#UNAVAILABLE` | `server_error` | `google: <Service> server error (<status>); temporarily unavailable` |

Where `<Service>` is `Gmail`, `Drive`, or `Calendar`; `<operation>` is the function name (e.g. `send`, `download`); `<status>` is the numeric HTTP status code.

**Token safety:** The token value never appears in any error message.

## Network and Lifecycle Errors

| Condition | Atom | `meta.raw.kind` | Message |
|-----------|------|---|---------|
| Request exceeds 30 s timeout | `#TIMEOUT` | `request_timeout` | `google: request timeout` |
| Session token variable absent from RuntimeContext | `#AUTH` | `session_token_missing` | `google: session token '<var>' not found` |
| `dispose()` already called | `#DISPOSED` | `disposed` | `google: operation cancelled` |
| In-flight request aborted by `dispose()` | `#DISPOSED` | `disposed` | `google: operation cancelled` |
| Network connection failure (DNS, refused) | `#UNAVAILABLE` | `connection_failed` | `google: <service> connection failed` |
| Unexpected response format (`SyntaxError`) | `#PROTOCOL` | `unexpected_response_format` | `google: unexpected response format` |

Where `<var>` is the `tokenVar` name from config and `<service>` is `gmail`, `drive`, or `calendar`.

## Retry Guidance

The extension performs no automatic retries. The caller manages backoff.

**`#RATE_LIMIT` — HTTP 429:**

The Google API returns HTTP 429 when quota is exhausted. The response may include a `Retry-After` header with a wait time in seconds. The extension does not read or expose this header. Implement exponential backoff in the calling script:

1. Match `guard #RATE_LIMIT && raw.kind == 'rate_limit_exceeded'`.
2. Wait at least 1 second before retrying. Double the wait on each subsequent 429.
3. Cap the wait at 60 seconds.
4. After 5 consecutive 429 responses, escalate or abort.

**`#UNAVAILABLE` — HTTP 5xx:**

Google API 5xx errors are transient. Retry with exponential backoff:

1. Match `guard #UNAVAILABLE && raw.kind == 'server_error'`.
2. Wait 1 second before the first retry.
3. Double the wait on each retry. Cap at 32 seconds.
4. After 3 consecutive 5xx responses, treat as a hard failure.

**`#AUTH` — HTTP 401:**

A 401 means the token is expired or invalid. Do not retry without refreshing the token first:

- Bearer mode: Obtain a new access token via your OAuth flow, then recreate the extension with the new token.
- Session mode: Update the RuntimeContext variable with a fresh token before retrying.
- Service account mode: The extension refreshes JWT tokens automatically. A 401 in service account mode indicates a key revocation or clock skew; recreate the extension.

**`#TIMEOUT`:**

A timeout (`raw.kind == 'request_timeout'`) means the 30-second limit was reached. Retries are appropriate for read operations. Avoid retrying write operations (send, upload, delete, create) without idempotency checks, as the original request may have completed.

**Capability and Validation Errors:**

Do not retry `#FORBIDDEN` capability errors or `#INVALID_INPUT` validation errors. These are configuration issues that require code or config changes, not transient failures. Factory-validation `RuntimeError RILL-R001` failures are similarly unrecoverable without restarting the host.
