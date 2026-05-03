# text Extension

*HTML processing, text normalization, and segmentation utilities for rill scripts*

**Node.js only.** This extension uses `String.prototype.normalize` (built-in), `html-to-text`, `turndown`, `defuddle/node`, `linkedom`, `entities`, and `linkify-it`. It does not run in browser environments.

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "text": "@rcrsr/rill-ext-text"
    }
  }
}
```

**app.rill**

```rill
use<ext:text> => $text

// Convert an email HTML body to plain text
$text.html_to_text($email.body) -> log

// Extract URLs from a newsletter
$text.extract_urls($text.html_to_text($email.body)) -> log
```

## Installation

```
pnpm add @rcrsr/rill-ext-text
```

## Configuration

No configuration required. The extension has no configurable parameters.

## Functions

### html_to_text

Convert an HTML string to plain text. `<script>` and `<style>` blocks are
removed. HTML entities (including `&nbsp;`) are decoded to their character
equivalents. Link URLs are omitted by default.

```rill
$text.html_to_text($email.body) -> log
$text.html_to_text($email.body, include_links: true) -> log
$text.html_to_text($email.body, word_wrap: false) -> log
$text.html_to_text($email.body, word_wrap_width: 120) -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `html` | string | — | HTML string to convert |
| `include_links` | bool | `false` | Append link `href` values inline after anchor text |
| `word_wrap` | bool | `true` | Wrap output at `word_wrap_width` columns |
| `word_wrap_width` | num | `80` | Column limit when `word_wrap` is `true` |

**Returns:** string

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `html` is not a string | `#INVALID_INPUT` | `non_string_input` |
| `include_links` is not a bool | `#INVALID_INPUT` | `invalid_option_type` |
| `word_wrap` is not a bool | `#INVALID_INPUT` | `invalid_option_type` |
| `word_wrap_width` is not a positive integer | `#INVALID_INPUT` | `invalid_word_wrap_width` |

---

### html_to_markdown

Convert an HTML string to CommonMark Markdown. Headings use ATX style (`#`).
Returns an empty string for empty input.

```rill
$text.html_to_markdown("<h1>Title</h1><p>Body text</p>") -> log
// "# Title\n\nBody text"
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `html` | string | — | HTML string to convert |

**Returns:** string (CommonMark Markdown)

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `html` is not a string | `#INVALID_INPUT` | `non_string_input` |

---

### extract_content

Extract the main article content from a full HTML page. Navigation elements,
advertisements, and sidebars are stripped. When no `<article>` or `<main>`
element is found, the function returns the raw `<body>` innerHTML.

```rill
$text.extract_content($page.html) -> log
$text.html_to_text($text.extract_content($page.html)) -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `html` | string | — | Full HTML document to extract content from |

**Returns:** string (HTML fragment)

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `html` is not a string | `#INVALID_INPUT` | `non_string_input` |

---

### decode_entities

Decode HTML entities in text. Named entities (`&amp;`, `&lt;`, etc.) and
numeric entities (`&#65;`, `&#x41;`, etc.) are decoded to their character
equivalents. Unknown entity sequences are returned verbatim. Input without
entities is returned unchanged.

```rill
$text.decode_entities("Hello &amp; World") -> log
// "Hello & World"

$text.decode_entities("&#65;&#66;&#67;") -> log
// "ABC"
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | — | Text containing HTML entities to decode |

**Returns:** string

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `text` is not a string | `#INVALID_INPUT` | `non_string_input` |

---

### decode_quoted_printable

Decode a quoted-printable encoded string (RFC 2045 §6.7). Soft line breaks
(`=\r\n`, `=\n`) are removed. `=XX` hex sequences are decoded to their UTF-8
character equivalents. Plain-text input is returned unchanged.

```rill
$text.decode_quoted_printable($email.raw_body) -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | — | Quoted-printable encoded text to decode |

**Returns:** string

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `text` is not a string | `#INVALID_INPUT` | `non_string_input` |

---

### strip_diacritics

Remove diacritical marks (accents, cedillas, tildes, etc.) from text. The
function decomposes to NFD and strips combining marks. ASCII-only input is
returned unchanged.

```rill
$text.strip_diacritics("café résumé") -> log
// "cafe resume"
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | — | Text from which to remove diacritics |

**Returns:** string

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `text` is not a string | `#INVALID_INPUT` | `non_string_input` |

---

### collapse_whitespace

Collapse runs of whitespace characters to a single space. By default, all
whitespace (spaces, tabs, newlines) is collapsed and the result is a single
line. With `preserve_newlines: true`, blank-line paragraph boundaries are
preserved while internal whitespace within each paragraph is collapsed.

```rill
$text.collapse_whitespace("hello    world\t!") -> log
// "hello world !"

$text.collapse_whitespace($article, preserve_newlines: true) -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | — | Text to normalize |
| `preserve_newlines` | bool | `false` | Preserve blank-line paragraph boundaries |

**Returns:** string

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `text` is not a string | `#INVALID_INPUT` | `non_string_input` |

---

### dedent

Remove the longest common leading-whitespace prefix from every non-empty line
in text. Empty or whitespace-only lines are ignored during prefix computation
but are kept in the output. When no common indent exists, text is returned
unchanged.

```rill
$text.dedent("  line one\n  line two") -> log
// "line one\nline two"
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | — | Indented text to dedent |

**Returns:** string

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `text` is not a string | `#INVALID_INPUT` | `non_string_input` |

---

### trim_lines

Split text on newlines, trim leading and trailing whitespace from each line,
and return only non-empty lines. Lines that are empty or contain only
whitespace after trimming are dropped. Returns an empty list for all-blank
input.

```rill
$text.trim_lines("  hello  \n  world  ") -> log
// ["hello", "world"]
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | — | Text whose lines should be trimmed |

**Returns:** string list

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `text` is not a string | `#INVALID_INPUT` | `non_string_input` |

---

### extract_urls

Extract all URLs from text and return them as a list. Includes
explicit-protocol URLs (`http:`, `https:`, `ftp:`, `ftps:`) and fuzzy
bare-hostname matches. Email addresses are excluded. Returns an empty list
when no URLs are found.

```rill
$text.extract_urls("Visit https://example.com and http://docs.example.com") -> log
// ["https://example.com", "http://docs.example.com"]
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | — | Text to extract URLs from |

**Returns:** string list

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `text` is not a string | `#INVALID_INPUT` | `non_string_input` |

---

### extract_emails

Extract all email addresses from text and return them as a list. Returns an
empty list when no email addresses are found.

```rill
$text.extract_emails("Contact alice@example.com or bob@example.com") -> log
// ["alice@example.com", "bob@example.com"]
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | — | Text to extract email addresses from |

**Returns:** string list

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `text` is not a string | `#INVALID_INPUT` | `non_string_input` |

---

### split_paragraphs

Split text into paragraphs separated by blank lines. One or more consecutive
blank lines count as a single separator. Trailing blank entries from a
trailing blank line are removed. Returns an empty list for empty or all-blank
input.

```rill
$text.split_paragraphs($article) -> log
// ["First paragraph.", "Second paragraph.", ...]
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | — | Text to split into paragraphs |

**Returns:** string list

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `text` is not a string | `#INVALID_INPUT` | `non_string_input` |

---

### window

Slide a fixed-size window over text and return the resulting chunks as a list.
When `step` equals `size` the windows are non-overlapping. When `step` is less
than `size` the windows overlap. The final window is included even when it is
shorter than `size`. Returns an empty list for empty input. Returns a
single-element list containing the full text when `text.length <= size`.

The function key `'window'` is safe even though it matches the browser global
of the same name. rill resolves host functions via string-key dispatch
(`callableDict['window']`), never as a bare JavaScript identifier. This
extension is Node.js-only, so the browser global is not present in any case.

```rill
$text.window($article, 500) -> log
// Non-overlapping 500-character chunks

$text.window($article, 500, 250) -> log
// 500-character chunks advancing 250 characters at a time (50% overlap)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | — | Text to slide a window over |
| `size` | num | — | Window size in characters |
| `step` | num | `size` | Step size between windows; defaults to `size` when omitted |

**Returns:** string list

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `text` is not a string | `#INVALID_INPUT` | `non_string_input` |
| `size` is not a positive integer | `#INVALID_INPUT` | `invalid_window_size` |
| `step` is not a positive integer | `#INVALID_INPUT` | `invalid_window_step` |

---

### truncate

Truncate text to a maximum character length. Returns text unchanged when
`text.length <= max`. When `word_boundary` is `true`, the function finds the
last whitespace at or before `max` and truncates there; when no whitespace
exists in the prefix, it falls back to a hard cut at `max`. The `ellipsis`
string is appended after the cut. Pass `""` for no ellipsis.

```rill
$text.truncate($article, 200, ellipsis: "...") -> log
$text.truncate($article, 200, word_boundary: true, ellipsis: "...") -> log
$text.truncate($article, 200, ellipsis: "") -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `text` | string | — | Text to truncate |
| `max` | num | — | Maximum length in characters |
| `word_boundary` | bool | `false` | Truncate at the last word boundary at or before `max` |
| `ellipsis` | string | — | String appended when text is truncated; pass `""` for none |

**Returns:** string

**Errors:**

| Failure | Atom | `meta.raw.kind` |
|---------|------|-----------------|
| `text` is not a string | `#INVALID_INPUT` | `non_string_input` |
| `max` is not a positive integer | `#INVALID_INPUT` | `invalid_max` |

---

## Error Handling

All functions emit failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #INVALID_INPUT`) or finely
(`guard #INVALID_INPUT && raw.kind == 'non_string_input'`).

```rill
$text.truncate($body, $max, ellipsis: "...")
  | guard #INVALID_INPUT { log("invalid argument") }
  -> $result
```

---

## Driver Scenarios

### Gmail Triage

Process raw email bodies for downstream LLM summarization. Emails may arrive
as quoted-printable encoded HTML. This pipeline decodes, extracts, converts,
and truncates in a single chain.

```rill
use<ext:text> => $text
use<ext:google_workspace> => $gws

// Fetch the latest unread message
$gws.gmail_get_message($gws.gmail_search("is:unread", max_results: 1)[0].id)
  -> $msg

// Decode quoted-printable if needed, then convert HTML to plain text
$text.decode_quoted_printable($msg.body)
  -> $text.html_to_text(include_links: false)
  -> $text.collapse_whitespace(preserve_newlines: true)
  -> $text.truncate(4000, word_boundary: true, ellipsis: "…")
  -> $plain_body

// Extract all links from the original HTML for reference
$text.extract_urls($text.html_to_text($msg.body, include_links: true)) -> $links
```

### RSS Article Extraction

Fetch an RSS article page, extract the main content, produce overlapping
chunks for vector embedding.

```rill
use<ext:text> => $text
use<ext:fetch> => $fetch

// Fetch the article page
$fetch.get($article.url) -> $response

// Extract main content, strip HTML, split into overlapping windows
$text.extract_content($response.body)
  -> $text.html_to_text()
  -> $text.collapse_whitespace(preserve_newlines: true)
  -> $text.window(1000, 200)
  -> $chunks

// Embed each chunk
for $chunk in $chunks {
  embed($chunk) -> $vectors
}
```

---

## Node.js Constraint

This extension is **Node.js-only** and cannot run in browser environments. It
uses:

- `defuddle/node` (requires Node.js DOM shim via `linkedom`)
- `String.prototype.normalize` (available in Node.js 13+)
- Native `decodeURIComponent` for quoted-printable UTF-8 decoding

The `window` host function name collides with the browser global `window` at
the JavaScript syntax level, but rill resolves host functions via string-key
dispatch (`callableDict['window']`), so no collision occurs at runtime. This
extension targets Node.js exclusively, so the browser global is absent.
