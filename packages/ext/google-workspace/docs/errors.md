# Error Reference — google-workspace Extension

All errors produced by the Google Workspace extension use error code `RILL-R004`. The extension never throws raw HTTP or SDK exceptions. Every error message begins with the `google:` prefix.

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

These errors throw at extension creation time, before any host function is callable.

| Condition | Error Code | Message |
|-----------|------------|---------|
| `auth` field absent or falsy | `RILL-R004` | `google: auth is required` |
| `auth.type` is not a valid variant | `RILL-R004` | `google: auth.type must be 'bearer', 'session', or 'service-account'` |
| Bearer mode: `auth.token` absent or empty | `RILL-R004` | `google: auth.token is required` |
| Session mode: `auth.tokenVar` absent or empty | `RILL-R004` | `google: auth.tokenVar is required` |
| Service account: `auth.keyJson` is not valid JSON | `RILL-R004` | `google: auth.keyJson is invalid: not valid JSON` |
| Service account: `auth.keyJson` missing `client_email` | `RILL-R004` | `google: auth.keyJson is invalid: missing field 'client_email'` |
| Service account: `auth.keyJson` missing `private_key` | `RILL-R004` | `google: auth.keyJson is invalid: missing field 'private_key'` |
| Service account: `auth.keyJson` missing `token_uri` | `RILL-R004` | `google: auth.keyJson is invalid: missing field 'token_uri'` |
| `gmail.maxResults` outside 1-500 | `RILL-R004` | `google: gmail.maxResults must be 1-500` |
| `drive.maxUploadBytes` is zero or negative | `RILL-R004` | `google: drive.maxUploadBytes must be positive` |
| `drive.allowedFolderIds` is an empty array | `RILL-R004` | `google: drive.allowedFolderIds must be non-empty` |
| `calendar.allowedCalendarIds` is an empty array | `RILL-R004` | `google: calendar.allowedCalendarIds must be non-empty` |

## Capability Gate Errors

These errors throw at call time when the required capability flag is `false`.

| Capability Checked | Error Code | Message |
|--------------------|------------|---------|
| `gmail.read` | `RILL-R004` | `google: gmail.read not enabled` |
| `gmail.search` | `RILL-R004` | `google: gmail.search not enabled` |
| `gmail.send` | `RILL-R004` | `google: gmail.send not enabled` |
| `gmail.draft` | `RILL-R004` | `google: gmail.draft not enabled` |
| `gmail.reply` | `RILL-R004` | `google: gmail.reply not enabled` |
| `gmail.label` | `RILL-R004` | `google: gmail.label not enabled` |
| `gmail.modify` | `RILL-R004` | `google: gmail.modify not enabled` |
| `drive.read` | `RILL-R004` | `google: drive.read not enabled` |
| `drive.list` | `RILL-R004` | `google: drive.list not enabled` |
| `drive.upload` | `RILL-R004` | `google: drive.upload not enabled` |
| `drive.download` | `RILL-R004` | `google: drive.download not enabled` |
| `drive.share` | `RILL-R004` | `google: drive.share not enabled` |
| `drive.delete` | `RILL-R004` | `google: drive.delete not enabled` |
| `calendar.read` | `RILL-R004` | `google: calendar.read not enabled` |
| `calendar.freeBusy` | `RILL-R004` | `google: calendar.freeBusy not enabled` |
| `calendar.create` | `RILL-R004` | `google: calendar.create not enabled` |

Capability errors produce no network traffic. The gate runs before token resolution.

## Label Errors (Gmail)

These errors throw when `gmail_label` is called with a label name that violates an allowlist or denylist.

| Condition | Error Code | Message |
|-----------|------------|---------|
| Label not in `allowedLabels` | `RILL-R004` | `google: label '<name>' not in allowed set` |
| Label appears in `deniedLabels` | `RILL-R004` | `google: label '<name>' in denied set` |

Where `<name>` is the label name passed by the caller, e.g. `google: label 'SPAM' in denied set`.

## Folder and File Errors (Drive)

These errors throw when a Drive call violates folder, MIME type, upload size, or role constraints.

| Condition | Error Code | Message |
|-----------|------------|---------|
| Folder not in `allowedFolderIds` | `RILL-R004` | `google: folder '<id>' not in allowed set` |
| MIME type in `deniedMimeTypes` | `RILL-R004` | `google: MIME type '<type>' not allowed` |
| Upload content exceeds `maxUploadBytes` | `RILL-R004` | `google: file exceeds maximum upload size (<n> bytes)` |
| `drive_share` role is not a valid value | `RILL-R004` | `google: drive.share role must be 'reader', 'commenter', or 'writer'` |

Where `<id>` is the folder ID, `<type>` is the MIME type string, and `<n>` is the configured `maxUploadBytes` value.

## Calendar Constraint Errors

These errors throw when Calendar calls violate date format, all-day, or calendar ID constraints.

| Condition | Error Code | Message |
|-----------|------------|---------|
| `startDate` or `endDate` is not ISO 8601 with timezone | `RILL-R004` | `google: <field> must be ISO 8601 with timezone` |
| `startTime` or `endTime` is not ISO 8601 with timezone | `RILL-R004` | `google: <field> must be ISO 8601 with timezone` |
| `denyAllDay: true` and event is an all-day event | `RILL-R004` | `google: all-day events not permitted` |
| Calendar ID not in `allowedCalendarIds` | `RILL-R004` | `google: calendar '<id>' not in allowed set` |

Where `<field>` is the parameter name (e.g. `startDate`, `startTime`) and `<id>` is the calendar ID.

A naive ISO 8601 date string without a timezone suffix (e.g. `"2026-04-26T09:00:00"` without `Z` or `+HH:MM`) is considered invalid.

## HTTP Errors

These errors throw when the Google API returns a non-success HTTP status.

| HTTP Status | Service | Error Code | Message Pattern |
|-------------|---------|------------|-----------------|
| 401 | Gmail | `RILL-R004` | `google: invalid Gmail token` |
| 401 | Drive | `RILL-R004` | `google: invalid Drive token` |
| 401 | Calendar | `RILL-R004` | `google: invalid Calendar token` |
| 403 | Gmail | `RILL-R004` | `google: insufficient Gmail scopes for <operation>` |
| 403 | Drive | `RILL-R004` | `google: insufficient Drive scopes for <operation>` |
| 403 | Calendar | `RILL-R004` | `google: insufficient Calendar scopes for <operation>` |
| 404 | Gmail | `RILL-R004` | `google: Gmail resource '<id>' not found` |
| 404 | Drive | `RILL-R004` | `google: Drive file '<id>' not found` |
| 404 | Calendar | `RILL-R004` | `google: Calendar resource '<id>' not found` |
| 429 | Any | `RILL-R004` | `google: rate limit exceeded; retry after delay` |
| 5xx | Gmail | `RILL-R004` | `google: Gmail server error (<status>); temporarily unavailable` |
| 5xx | Drive | `RILL-R004` | `google: Drive server error (<status>); temporarily unavailable` |
| 5xx | Calendar | `RILL-R004` | `google: Calendar server error (<status>); temporarily unavailable` |

Where `<operation>` is the function name (e.g. `send`, `download`) and `<status>` is the numeric HTTP status code.

**Token safety:** The token value never appears in any error message.

## Network and Lifecycle Errors

| Condition | Error Code | Message |
|-----------|------------|---------|
| Request exceeds 30 s timeout | `RILL-R004` | `google: request timeout` |
| Session token variable absent from RuntimeContext | `RILL-R004` | `google: session token '<var>' not found` |
| `dispose()` already called | `RILL-R004` | `google: operation cancelled` |
| In-flight request aborted by `dispose()` | `RILL-R004` | `google: operation cancelled` |
| Network connection failure (DNS, refused) | `RILL-R004` | `google: <service> connection failed` |

Where `<var>` is the `tokenVar` name from config and `<service>` is `gmail`, `drive`, or `calendar`.

## Retry Guidance

The extension performs no automatic retries. The caller manages backoff.

**HTTP 429 — Rate Limit:**

The Google API returns HTTP 429 when quota is exhausted. The response may include a `Retry-After` header with a wait time in seconds. The extension does not read or expose this header. Implement exponential backoff in the calling script:

1. Catch the `RILL-R004` error with message `google: rate limit exceeded; retry after delay`.
2. Wait at least 1 second before retrying. Double the wait on each subsequent 429.
3. Cap the wait at 60 seconds.
4. After 5 consecutive 429 responses, escalate or abort.

**HTTP 5xx — Server Error:**

Google API 5xx errors are transient. Retry with exponential backoff:

1. Catch the `RILL-R004` error with message containing `server error`.
2. Wait 1 second before the first retry.
3. Double the wait on each retry. Cap at 32 seconds.
4. After 3 consecutive 5xx responses, treat as a hard failure.

**HTTP 401 — Invalid Token:**

A 401 means the token is expired or invalid. Do not retry without refreshing the token first:

- Bearer mode: Obtain a new access token via your OAuth flow, then recreate the extension with the new token.
- Session mode: Update the RuntimeContext variable with a fresh token before retrying.
- Service account mode: The extension refreshes JWT tokens automatically. A 401 in service account mode indicates a key revocation or clock skew; recreate the extension.

**Request Timeout:**

A timeout error (`google: request timeout`) means the 30-second limit was reached. Retries are appropriate for read operations. Avoid retrying write operations (send, upload, delete, create) without idempotency checks, as the original request may have completed.

**Capability and Validation Errors:**

Do not retry `RILL-R004` errors from factory validation or capability gates. These are configuration issues that require code or config changes, not transient failures.
