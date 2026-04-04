# Changelog

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
