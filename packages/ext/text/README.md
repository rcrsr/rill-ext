# @rcrsr/rill-ext-text

[rill](https://rill.run) extension for text processing. Provides HTML-to-text conversion, Markdown conversion, web content extraction, entity decoding, Unicode utilities, URL/email extraction, and text segmentation.

> **Node.js only.** This extension uses Node.js-only packages (`linkedom`, `defuddle`, `html-to-text`) and does not run in browser or edge environments.

Bundle size: 20 KB (20,477 bytes, measured against `dist/index.js`).

## Install

```bash
npm install @rcrsr/rill-ext-text
```

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "text": "@rcrsr/rill-ext-text"
    },
    "config": {
      "text": {}
    }
  }
}
```

**app.rill**

```rill
use<ext:text> => $text

$text.html_to_text("<h1>Hello</h1><p>World</p>") -> log
$text.html_to_markdown("<h1>Hello</h1><p>World</p>") -> log
$text.extract_urls("Visit https://rill.run for docs.") -> log
$text.truncate("A long article body...", 100, false, "...") -> log
```

```bash
rill-run
```

## Function Catalog

| Function | Description |
|----------|-------------|
| `html_to_text` | Convert HTML to plain text |
| `html_to_markdown` | Convert HTML to Markdown |
| `extract_content` | Extract main article content from an HTML page |
| `decode_entities` | Decode HTML entities (e.g. `&amp;` to `&`) |
| `decode_quoted_printable` | Decode quoted-printable encoded strings (MIME) |
| `strip_diacritics` | Remove diacritical marks from Unicode text |
| `collapse_whitespace` | Collapse consecutive whitespace to a single space |
| `dedent` | Remove common leading whitespace from multi-line strings |
| `trim_lines` | Trim leading and trailing whitespace from each line |
| `extract_urls` | Extract URLs from plain text |
| `extract_emails` | Extract email addresses from plain text |
| `split_paragraphs` | Split text into paragraphs on blank-line boundaries |
| `window` | Slide a fixed-size window over text and return overlapping chunks |
| `truncate` | Truncate text to a word or character boundary with configurable ellipsis |

See [full documentation](docs/extension-text.md) for per-function parameters, return shapes, and error handling.

## License

MIT
