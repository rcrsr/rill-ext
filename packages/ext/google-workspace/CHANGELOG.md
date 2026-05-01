# Changelog

## [0.19.4] - 2026-04-30

### Changed (Breaking)

- All 8 dict-returning callables (`gmail_search`, `gmail_read`, `drive_list`, `drive_upload`, `drive_get_metadata`, `calendar_events`, `calendar_today`, `calendar_free_busy`) declare concrete `returnType` shapes per `.claude/policies/policy-domain-ext.md` §EXT.8. Drive file metadata fields are shared between `drive_list` (each `files` element) and `drive_get_metadata` (top-level dict); calendar event fields are shared between `calendar_events` and `calendar_today`. `calendar_free_busy` types as a homogeneous email-keyed dict (`dict(string: dict(busy: list(dict(start, end))))`). Inner Google calendar `start` / `end` blocks remain typed as `any` because the host fn forwards them without reshaping (they retain Google's camelCase `dateTime` / `timeZone` keys). Scripts introspecting any callable's `returnType` property previously saw `dict`; they now see the precise top-level field set.

### Fixed

- `calendar_today` previously emitted `displayName` and `responseStatus` (camelCase) inside attendee dicts, violating the snake_case boundary rule in root `CLAUDE.md` §Boundary Key Naming. The keys are now `display_name` and `response_status`, matching `calendar_events`.
- `gmail_read` attachment dicts previously emitted `mimeType` (camelCase). The key is now `mime_type`. Both fixes are noted as breaking for scripts that read those fields.

### Documentation

- `docs/README.md` updated to reflect the actual response shapes returned by code (per `.claude/policies/policy-domain-ext.md` §EXT.8.4 documentation parity):
  - `gmail_read` table replaces the previous flat `subject`/`from`/`to`/`date` rows with a nested `headers` dict and adds the `attachments` row. `snippet` and `labels` rows removed because the implementation does not return them.
  - `drive_upload` table adds `size` (number) and `owner` (string \| null) rows.
  - `calendar_events` and `calendar_today` tables expand the event element shape and explicitly note that `start` / `end` carry Google's camelCase keys.
  - `calendar_free_busy` table replaces the previous `{schedules: dict}` claim with the actual flat email-keyed dict.

## [0.19.3] - 2026-04-30

### Changed

- `docs/` (README.md, auth.md, capabilities.md, errors.md) now ships in the npm tarball via `package.files`. Relative `docs/...` links in the package README resolve on npm, and the response-shape reference for Gmail/Drive/Calendar dicts is published alongside `dist/index.d.ts` (the `.d.ts` exposes callables as opaque `ApplicationCallable`, so the markdown is the response-shape source of truth).

### Documentation

- README lists all four auth modes (`bearer`, `session`, `service-account`, `oauth-refresh`), matching the type declarations.
- `docs/README.md` Top-Level Parameters table adds the three `oauth-refresh` field rows (`auth.client_id`, `auth.client_secret`, `auth.refresh_token`).
- Corrected the stale "all three auth variants" wording in `docs/README.md` to "all four".

## [0.19.2] - 2026-04-30

### Changed (Breaking)

- All boundary keys renamed to snake_case per root `CLAUDE.md` §Boundary Key Naming. Param renames: `messageId`→`message_id`, `fileId`→`file_id`, `folderId`→`folder_id`, `labelName`→`label_name`, `startDate`→`start_date`, `endDate`→`end_date`, `startTime`→`start_time`, `endTime`→`end_time`. Options dict keys: `maxResults`→`max_results`, `mimeType`→`mime_type`, `calendarId`→`calendar_id`, `allDay`→`all_day`, `sendUpdates`→`send_updates`. Return dict keys (drive, calendar): `threadId`→`thread_id`, `mimeType`→`mime_type`, `displayName`→`display_name`, `emailAddress`→`email_address`, `createdTime`→`created_time`, `modifiedTime`→`modified_time`, `responseStatus`→`response_status`. Host scripts must update all calls and field accesses. JS-side config (`auth`, `gmail.maxResults`, etc.) is unaffected.

## [0.19.1] - 2026-04-28

### Added

- `auth.type: "oauth-refresh"` variant accepting `client_id`, `client_secret`, and `refresh_token`. Exchanges the refresh token at the Google OAuth2 token endpoint and caches the access token with TTL = `expires_in - 300` seconds, refreshing transparently on expiry. Resolves the friction documented in `FEATURE-google-workspace-auth-refresh.md` for Desktop OAuth clients and personal Gmail/Drive/Calendar accounts

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.7] - 2026-04-26

Initial release. Functions: 17 callables across Gmail, Google Drive, and Google Calendar. Authentication: bearer token, session, and service account (RS256 JWT). Capability gating per service. Exports `extensionManifest` for `rill-run` mounting. Includes runnable examples under `examples/` (gmail-triage, drive-upload, calendar-scheduling).
