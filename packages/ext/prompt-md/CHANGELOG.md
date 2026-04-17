# Changelog

## [0.18.5] - 2026-04-17

### Added

- Initial release of `@rcrsr/rill-ext-prompt-md`
- Loads typed prompt templates from `*.prompt.md` files with YAML frontmatter
- Validates prompts at startup and exposes each as a named callable for LLM `messages()` entry points

### Fixed

- Export `extensionManifest` so `rill-run` auto-mount succeeds (previously aborted with `does not export extensionManifest`)
