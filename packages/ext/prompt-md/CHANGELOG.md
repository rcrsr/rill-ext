# Changelog

## [0.18.6] - 2026-04-17

### Changed (Breaking)

- Peer dep on `@rcrsr/rill` bumped to `~0.18.6` to consume re-exported `tokenize`, `createParserState`, and `parseTypeRef`
- `params` type grammar delegates to rill's `parseTypeRef`. Legacy alias `num` is hard-rejected; use `number`. Legacy alias `callable` is hard-rejected and has no replacement — function-typed params are not supported in prompt-md
- Param type names `closure`, `iterator`, `stream`, `vector`, and `type` are hard-rejected. These render as placeholder strings (e.g. `type(closure)`, `vector(model, Nd)`) and have no useful rendering in prompt templates.
- Interpolation renders every `RillValue` via rill's `formatValue`; dicts and lists no longer throw but produce rill canonical literal syntax (not JSON)

### Added

- `params` now accepts full rill type expressions, including parameterized and nested forms such as `list(T)`, `dict(T)`, `dict(a: T1, b: T2)`, and `list(dict(a: string, b: string))`

### Fixed

- README and docs no longer show invalid unquoted YAML for `params` entries; each entry must be a YAML string literal

## [0.18.5] - 2026-04-17

### Added

- Initial release of `@rcrsr/rill-ext-prompt-md`
- Loads typed prompt templates from `*.prompt.md` files with YAML frontmatter
- Validates prompts at startup and exposes each as a named callable for LLM `messages()` entry points

### Fixed

- Export `extensionManifest` so `rill-run` auto-mount succeeds (previously aborted with `does not export extensionManifest`)
