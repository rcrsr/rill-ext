# Changelog

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
