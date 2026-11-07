# Changelog

## [Unreleased]

### Changed

- **Test suite trust:** Test files are type-checked and their type errors fixed. No runtime change. ([#147](https://github.com/rcrsr/rill-ext/pull/147))
- **Test suite cleanup:** Removes redundant and self-evident tests, parametrizes copy-paste cases, and tightens weak or misnamed assertions. ([#150](https://github.com/rcrsr/rill-ext/pull/150))

## [0.23.0] - 2026-11-06

### Changed

- **rill 0.23 migration:** `@rcrsr/rill` peer and dev ranges move from `~0.21.0` to `~0.23.0`. Extensions at `0.23.x` require rill `0.23.x`; consumers on rill `0.21.x` must stay on extensions `0.21.x`. ([#145](https://github.com/rcrsr/rill-ext/pull/145))
- Bumps `entities` to `^9.0.0` (from `^8.1.0`, major), `defuddle` to `^0.19.6`, `linkedom` to `^0.18.15`, and `turndown` to `^7.2.5`. In-use API surface unchanged. ([#145](https://github.com/rcrsr/rill-ext/pull/145))
- Bumps `defuddle` to `^0.19.4` (from `^0.19.3`) and `entities` to `^8.1.0` (from `^8.0.0`). In-use API surface unchanged. ([#131](https://github.com/rcrsr/rill-ext/pull/131))

## [0.21.0] - 2026-09-09

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped from `~0.20.0` to `~0.21.0`. This package now requires rill `0.21.x`; consumers on rill `0.20.x` must stay on `0.20.x` of this package. ([#123](https://github.com/rcrsr/rill-ext/pull/123))
- No runtime surface changes. No callable signatures, parameter names, return shapes, or error atoms changed.

### Changed

- `linkify-it` 5→6: the package ships its own types and uses the named `LinkifyIt` export; `@types/linkify-it` dropped. Output unchanged. ([#103](https://github.com/rcrsr/rill-ext/pull/103))

## [0.20.0] - 2026-07-30

### Changed (Breaking)

- `@rcrsr/rill` peer dependency bumped from `~0.19.0` to `~0.20.0`. This package now requires rill `0.20.x`; consumers on rill `0.19.x` must stay on `0.19.x` of this package.
- `engines.node` bumped from `>=22.0.0` to `>=22.16.0`, matching the `engines.node` floor that `@rcrsr/rill@0.20.0` declares.
- No runtime surface changes. No callable signatures, parameter names, return shapes, or error atoms changed.

## [0.19.1] - 2026-07-11

### Added

- **rill.role declaration:** Declares `"rill": { "role": "extension" }` in `package.json` so the rill-cli install gate admits this package. ([#58](https://github.com/rcrsr/rill-ext/pull/58))

### Changed

- Bumps `defuddle` to `^0.19.1` (from `^0.18.1`). In-use API surface unchanged. ([#57](https://github.com/rcrsr/rill-ext/pull/57))
- **linkedom and linkify-it:** Bumps linkedom to ^0.18.13 and linkify-it to ^5.0.2. ([#61](https://github.com/rcrsr/rill-ext/pull/61))

## [0.19.0] - 2026-05-02

### Added

- `html_to_text`: Convert HTML to plain text via `html-to-text`.
- `html_to_markdown`: Convert HTML to Markdown via `turndown`.
- `extract_content`: Extract main article content from HTML via `defuddle` and `linkedom`.
- `decode_entities`: Decode HTML entities via `entities`.
- `decode_quoted_printable`: Decode quoted-printable encoded strings.
- `strip_diacritics`: Remove diacritical marks from Unicode text.
- `collapse_whitespace`: Collapse consecutive whitespace characters to a single space.
- `dedent`: Remove common leading whitespace from multi-line strings.
- `trim_lines`: Trim leading and trailing whitespace from each line.
- `extract_urls`: Extract URLs from plain text via `linkify-it`.
- `extract_emails`: Extract email addresses from plain text.
- `split_paragraphs`: Split text into paragraphs on blank-line boundaries.
- `window`: Slide a fixed-size window over text and return overlapping chunks.
- `truncate`: Truncate text to a word or character boundary with configurable ellipsis.

### Library choices

- `html-to-text` for `html_to_text`; `turndown` for `html_to_markdown`.
- `entities` (TD-3) for `decode_entities` — chosen over the stale `he` package.
- `linkedom` + `defuddle` (TD-4) for `extract_content`. Bundle measured at 20 KB, well under the 1 MB cap; the sub-export fallback (TD-4) was NOT triggered.
- `linkify-it@5.0.0` (TD-5) for both `extract_urls` and `extract_emails`.
- Zero-dependency built-ins (TD-6) for `decode_quoted_printable` and `strip_diacritics`.

### Bundle size

dist/index.js = 20 KB (20,477 bytes). Measured at initial release.

Initial release. Node.js 22+ required (matches workspace `engines.node`).
