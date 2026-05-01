# Changelog

## [0.19.1] - 2026-04-30

### Changed (Breaking)

- The three resource read callables (`read_resource`, generated static resource functions, and generated resource template functions) declare `returnType` as `anyTypeValue` instead of shapeless `dict`, per `.claude/policies/policy-domain-ext.md` §EXT.8. `parseResourceContent` returns string, dict, or other structured content depending on the resource's content blocks; the schema is determined at runtime by the MCP server (§EXT.8.3 case 4 — heterogeneous runtime state). Tool callables (with `outputSchema`) and prompt callables already declared concrete shapes; unchanged. Scripts introspecting these callables' `returnType` previously saw bare `dict`; they now see `any`, which more accurately reflects the dynamic shape.

## [0.19.0] - 2026-04-28

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped to `~0.19.0`.
- Migrated to rill 0.19's generic-atom error model. In-host-fn failures emit invalid `RillValue`s via `ctx.invalidate(...)` carrying core atoms (`#AUTH`, `#NOT_FOUND`, `#RATE_LIMIT`, `#UNAVAILABLE`, `#INVALID_INPUT`, `#DISPOSED`, etc.) instead of throwing `RuntimeError('RILL-R004', ...)`. Factory-time validation uses `RuntimeError('RILL-R001', ...)`. Host scripts pattern-match via `guard #ATOM` and `meta.raw.kind`.
- Factory accepts optional `ExtensionFactoryCtx` second argument; `ctx.signal` composes with per-call cancellation.

## [0.18.4] - 2026-04-05

### Changed

- `@modelcontextprotocol/sdk` updated from ^1.27.1 to ^1.29.0
- Mock test server updated to use Zod schemas (SDK 1.29.0 requirement)

## [0.18.1] - 2026-04-03

### Fixed

- `@rcrsr/rill-ext-param-shared` moved from `dependencies` to `devDependencies`

## [0.18.0] - 2026-04-02

### Breaking Changes

- Capabilities restructured as namespace dicts (`.tools`, `.resources`, `.prompts`)
- `createIntrospectionDicts` replaces `createIntrospectionFunctions`
- Prompt names no longer prefixed with `prompt_`

### Added

- Static resource shortcut callables via `generateStaticResourceFunctions()`
- `jsonSchemaToTypeStructure()` converts outputSchema to rill TypeStructure
- Name sanitizer handles whitespace in MCP identifiers

### Fixed

- `buildCallableDict` preserves existing annotations instead of overwriting
- Static resource error messages use sanitized callable name, not raw MCP name
