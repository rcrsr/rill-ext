# Changelog

## [0.18.4] - 2026-04-05

### Changed

- `better-sqlite3` updated from ^12.6.2 to ^12.8.0

## [0.18.3] - 2026-04-05

### Changed

- Import `KvExtensionContract` and `SchemaEntry` from `@rcrsr/rill-ext-kv-shared` instead of `@rcrsr/rill`

## [0.18.1] - 2026-04-03

### Fixed

- `@rcrsr/rill-ext-param-shared` moved from `dependencies` to `devDependencies`

## [0.18.0] - 2026-04-02

### Breaking Changes

- Path API changed from `(mount, key)` to combined `/mount/key` string
- `mounts` returns list of mount detail dicts instead of name list
