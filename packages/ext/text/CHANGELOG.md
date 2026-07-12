# Changelog

## [Unreleased]

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
