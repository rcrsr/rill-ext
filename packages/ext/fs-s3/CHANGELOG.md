# Changelog

## [0.18.3] - 2026-04-05

### Changed

- Import `FsExtensionContract` from `@rcrsr/rill-ext-fs-shared` instead of `@rcrsr/rill`

## [0.18.1] - 2026-04-03

### Fixed

- `@rcrsr/rill-ext-param-shared` moved from `dependencies` to `devDependencies`

## [0.18.0] - 2026-04-02

### Breaking Changes

- Path API changed from `(mount, path)` to combined `/mount/path` string
- `parseMountPath()` replaces `getMount()` + `mapPath()` with longest-match routing
- `stat` returns `name`, `type`, `modified` (ISO string) instead of epoch number
- `mounts` returns list of mount detail dicts instead of name list
- `copy`/`move` validate same-mount constraint on src and dest
