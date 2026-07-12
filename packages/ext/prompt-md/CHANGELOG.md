# Changelog

## [Unreleased]

### Added

- **rill.role declaration:** Declares `"rill": { "role": "extension" }` in `package.json` so the rill-cli install gate admits this package. ([#58](https://github.com/rcrsr/rill-ext/pull/58))

### Changed

- **yaml 2.9.0:** Bumps yaml to ^2.9.0 and the openai dev dependency to ^6.46.0. ([#61](https://github.com/rcrsr/rill-ext/pull/61))

## [0.19.3] - 2026-05-01

### Changed

- `output: 'list'` prompts now target `message(list)` on LLM extensions instead of the removed
  `messages()` verb. The returned `list(dict(role, content))` shape is unchanged; downstream LLM
  extensions accept it via `normalizePrompt` sugar expansion inside `message()`.
- Role-allowlist enforcement added in `@rcrsr/rill-ext-prompt-shared`: `splitRoleMessages` now
  rejects unrecognized role markers at parse time, preventing invalid role values from reaching LLM
  provider APIs.

## [0.19.2] - 2026-04-30

### Changed (Breaking)

- The `output:` frontmatter field is removed. Output mode is inferred from body content: the presence of one or more `@@ role` marker lines yields `output: list`, absence yields `output: string`. Existing files with stale `output:` keys parse without error (the field is ignored), so this is breaking only for files that depended on the previous validation error paths (EC-10 dict-reserved, EC-11 unknown-output, EC-14 list-without-marker). The `^output` annotation continues to expose `"string"` or `"list"`.
- Closure `returnType` is now concrete instead of `any`. `output: 'string'` prompts return type `string`; `output: 'list'` prompts return type `list(dict(role: string, content: string))`. Scripts that introspected the callable's `returnType` property previously saw `any`; they now see the precise shape.

### Removed

- Factory-time error paths EC-10 (`output: dict` reserved), EC-11 (unrecognized output value), and EC-14 (`output: list` body without `@@` marker). Inference makes all three impossible by construction.

## [0.19.1] - 2026-04-30

### Fixed

- `dist/index.js` now bundles the `yaml` dependency inline and ships a `createRequire(import.meta.url)` banner so the extension loads as pure ESM. Previously, downstream re-bundlers (e.g., `rill-build`) inlined yaml's CJS dist verbatim, producing dynamic `require("process")` calls that ESM cannot execute, surfacing as `ExtensionLoadError: Dynamic require of "process" is not supported` when running compiled extension bundles. Source-mode (`rill-run`) was unaffected.
- Resolution names derived from `*.prompt.md` filenames now replace hyphens (`-`) with underscores (`_`) so the callable is invocable from rill scripts. Previously a file named `summarize-email.prompt.md` registered without error but `$prompt.summarize_email(...)` halted at runtime because the runtime cannot resolve a callable whose key contains `-`. Hyphens convert across all path segments, so `daily-tasks/morning-brief.prompt.md` registers as `daily_tasks.morning_brief`.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

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
