# Changelog

## [Unreleased]

## [0.20.0] - 2026-07-30

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped from `~0.19.0` to `~0.20.0`. This package now requires rill `0.20.x`; consumers on rill `0.19.x` must stay on `0.19.x` of this package.
- No runtime surface changes. No callable signatures, parameter names, return shapes, or error atoms changed.

## [0.19.3] - 2026-07-11

### Added

- **rill.role declaration:** Declares `"rill": { "role": "extension" }` in `package.json` so the rill-cli install gate admits this package. ([#58](https://github.com/rcrsr/rill-ext/pull/58))

## [0.19.2] - 2026-04-30

### Changed (Breaking)

- All 12 host-function callables declare concrete `returnType` shapes per `.claude/policies/policy-domain-ext.md` §EXT.8. `MailMessageDict` (9 fields) is shared across `inbox`, `from`, `search`, `read`, `draft`, `flag`. `CalendarEventDict` (8 fields) is shared across `events`, `today`, `create_event`. `FreeBusyScheduleDict` (3 fields with nested `items` list) is used by `free_busy`. `send` and `reply` return `dict(sent: bool, to: list(string), subject: string)`. Scripts introspecting the callable's `returnType` property previously saw `dict`; they now see the precise top-level field set.
- Snake_case boundary fixes folded in (root `CLAUDE.md` §Boundary Key Naming): `MailMessageDict.hasAttachments` → `has_attachments`; `CalendarEventDict.isOnline` → `is_online`; `CalendarEventDict.onlineUrl` → `online_url`; `FreeBusyScheduleDict.scheduleId` → `schedule_id`. The `create_event` options dict's `isOnline` flag is now `is_online`. Scripts reading those fields must update.

### Documentation

- `docs/extension-outlook.md` updated to reflect the actual response shapes (per §EXT.8.4 documentation parity):
  - The `flag` Result Dict section previously claimed `{ id: string, flagged: boolean }`; the implementation returns the full message dict with `flagged` set to `true`. Section rewritten to cross-reference the Message Dict Shape.
  - New "Calendar Event Dict Shape" section documents the 8-field event dict; cross-references added from `events`, `today`, and `create_event` Result Dicts.
  - Snake_case field renames reflected throughout (Message Dict Shape, Calendar Event Dict Shape, free_busy schedules, create_event options).

## [0.19.1] - 2026-04-30

### Changed (Breaking)

- Boundary keys renamed to snake_case per root `CLAUDE.md` §Boundary Key Naming. Param: `messageId` → `message_id` on `read`, `reply`, `flag`. Event payload fields: `messageCount` → `message_count`, `messageId` → `message_id`, `eventCount` → `event_count`, `resultCount` → `result_count`. Host scripts calling `read({ messageId: ... })` etc. must update.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.5] - 2026-04-17

### Added

- Initial release of `@rcrsr/rill-ext-outlook`
- 12 host functions over Microsoft Graph REST API v1.0
- Mail read: `inbox`, `from`, `search`, `read`
- Mail write: `send`, `draft`, `reply`, `flag`
- Calendar: `events`, `today`, `free_busy`, `create_event`
- Two auth modes: `bearer` (static token) and `session` (per-call from RuntimeContext)
- Capability gating with configurable permission flags
- Folder allowlist enforcement on `inbox`
- Shared mailbox support via `/users/{mailbox}/` endpoints
- Zero vendor SDK dependencies (native `fetch` for all HTTP calls)
