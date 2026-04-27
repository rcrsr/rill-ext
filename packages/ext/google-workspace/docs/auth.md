# Authentication — google-workspace Extension

This document covers all three authentication variants, when to use each, GCP service account setup, and domain-wide delegation configuration.

## Contents

- [Quick Setup via CLI](#quick-setup-via-cli)
- [Variant Comparison](#variant-comparison)
- [Bearer Token](#bearer-token)
- [Session Token](#session-token)
- [Service Account](#service-account)
- [GCP Project & Scopes Reference](#gcp-project--scopes-reference)
- [Security Notes](#security-notes)

## Quick Setup via CLI

Use the [Google Workspace CLI](https://github.com/googleworkspace/cli) to provision a GCP project, enable APIs, create credentials, and run the OAuth flow without manual console clicks.

```bash
gws auth setup    # creates project, enables APIs, generates OAuth client
gws auth login    # runs OAuth consent and prints an access token
```

Pipe the resulting token into the extension config as `${GOOGLE_TOKEN}` (bearer) or store the service account key JSON in `${GOOGLE_SERVICE_ACCOUNT_JSON}`. See the CLI repository for full command reference.

## Variant Comparison

| | bearer | session | service-account |
|--|--------|---------|-----------------|
| Token source | Config (static) | RuntimeContext (per-call) | GCP key JSON (auto-refreshed) |
| Token lifetime | Until expiry | Until expiry | Short-lived JWT (1 hour, cached) |
| Multi-user support | No | Yes | Yes (via `subject`) |
| Requires GCP project | No | No | Yes |
| Requires OAuth consent | Yes (manual) | Yes (per user) | No |
| Best for | Scripts, CI pipelines | Per-user web flows | Server automation, service accounts |

## Bearer Token

Supply a static OAuth 2.0 Bearer token obtained from your own OAuth flow or the Google OAuth 2.0 Playground.

```json
{
  "auth": {
    "type": "bearer",
    "token": "${GOOGLE_TOKEN}"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"bearer"`. |
| `token` | string | Yes | A valid Google OAuth 2.0 access token. Must be non-empty. |

**When to use:** Short-lived scripts, local development, or CI pipelines where you control token rotation.

**Limitations:** The token is static. When it expires (typically after 1 hour), calls return HTTP 401. Rotate the token externally and restart the extension.

**Scopes required** depend on which capabilities you enable:

| Service | Scope |
|---------|-------|
| Gmail (read) | `https://www.googleapis.com/auth/gmail.readonly` |
| Gmail (send) | `https://www.googleapis.com/auth/gmail.send` |
| Gmail (modify) | `https://www.googleapis.com/auth/gmail.modify` |
| Drive (read/list/download) | `https://www.googleapis.com/auth/drive.readonly` |
| Drive (upload/share/delete) | `https://www.googleapis.com/auth/drive` |
| Calendar (read/freeBusy) | `https://www.googleapis.com/auth/calendar.readonly` |
| Calendar (create) | `https://www.googleapis.com/auth/calendar` |

## Session Token

Resolve the Bearer token from a named `RuntimeContext` variable at each call. This supports per-user tokens in multi-tenant scripts.

```json
{
  "auth": {
    "type": "session",
    "tokenVar": "user_google_token"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"session"`. |
| `tokenVar` | string | Yes | Name of the RuntimeContext variable that holds the Bearer token. Must be non-empty. |

**When to use:** Multi-tenant applications where each user has their own OAuth token. The host application sets the variable in the RuntimeContext before invoking the script.

**Token resolution:** At each call, the extension reads `ctx.getVariable(tokenVar)`. If the variable is absent, the call throws `RILL-R004: google: session token '<var>' not found`.

**Token lifetime:** Same as bearer. The host application is responsible for refreshing the token before it expires and updating the RuntimeContext variable.

## Service Account

Authenticate as a GCP service account using a downloaded JSON key file. The extension generates short-lived JWT access tokens automatically and caches them for up to 1 hour.

```json
{
  "auth": {
    "type": "service-account",
    "keyJson": "${GOOGLE_SERVICE_ACCOUNT_JSON}"
  }
}
```

With domain-wide delegation to act on behalf of a specific user:

```json
{
  "auth": {
    "type": "service-account",
    "keyJson": "${GOOGLE_SERVICE_ACCOUNT_JSON}",
    "subject": "alice@yourdomain.com"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"service-account"`. |
| `keyJson` | string | Yes | Full content of the GCP service account key JSON file as a string. |
| `subject` | string | No | Email address to impersonate via domain-wide delegation. Omit to act as the service account itself. |

**When to use:** Automated server workflows, background jobs, or any scenario where no human user is involved and you want automatic token refresh.

**Required JSON fields:** The `keyJson` must be a valid JSON object containing `client_email`, `private_key`, and `token_uri`. Missing fields produce a `RILL-R004` error at factory creation time.

## GCP Project & Scopes Reference

For most users, the [Google Workspace CLI](https://github.com/googleworkspace/cli) handles project creation, API enablement, OAuth client generation, service account key creation, and domain-wide delegation registration. Use the manual console flow only when the CLI is unavailable.

**APIs the project must enable:**

| Service | API |
|---------|-----|
| Gmail | Gmail API |
| Drive | Google Drive API |
| Calendar | Google Calendar API |

**Domain-wide delegation:** When using `service-account` auth with `subject`, the service account's Client ID must be authorized for the requested OAuth scopes in the [Google Workspace Admin Console](https://admin.google.com) under **Security > API Controls > Domain-wide Delegation**. The CLI registers this for you. `subject` must be an explicit email address; there is no implicit fallback.

**Scope minimization:** The extension requests only the scopes needed for enabled capabilities. It never requests wildcard scopes.

## Security Notes

- The token value (bearer or service account private key) never appears in error messages or runtime events.
- The `keyJson` string lives in the factory closure only. It is not passed to any event emission.
- Capability gates execute before token resolution and before any network call, so a disabled capability produces no network traffic.
- All requests use HTTPS. There is no protocol override parameter.
- `subject` must be set explicitly to enable impersonation. The extension does not fall back to implicit user identity.
