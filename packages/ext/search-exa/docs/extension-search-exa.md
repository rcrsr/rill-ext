# exa Extension

*Exa AI search API integration for rill scripts*

This extension allows rill scripts to access the Exa AI search API. The host declares it in `rill-config.json`, and scripts load it with `use<ext:exa>`. Switching to a different search provider means changing the extension mount. Scripts stay identical.

Four functions cover the core search operations. `search` runs neural or keyword search against the Exa index. `contents` fetches the text of specific URLs. `find_similar` returns pages similar to a given URL. `answer` returns an AI-generated answer with source citations. Each call emits a structured event for host-side logging and metrics.

The host sets the API key and timeout at creation time. Scripts never handle credentials.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "exa": "@rcrsr/rill-ext-search-exa"
    },
    "config": {
      "exa": {
        "apiKey": "${EXA_API_KEY}"
      }
    }
  }
}
```

Rill script — load the extension as a handle and call functions via dot-path:

```rill
use<ext:exa> => $search
$search.search("rill scripting language") => $result
$result.results -> log
```

Direct dot-path — no intermediate variable:

```rill
use<ext:exa.search>("rill scripting language") => $result
```

Secondary pattern (still works, not primary):

```rill
exa::search("rill scripting language")
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "exa": {
        "apiKey": "${EXA_API_KEY}",
        "baseUrl": "https://api.exa.ai",
        "timeout": 30000
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `apiKey` | string | — | Exa API key (required) |
| `baseUrl` | string | `"https://api.exa.ai"` | Base URL for the Exa API |
| `timeout` | number | `30000` | Request timeout in ms |

## Functions

**search(query, options?)** — Neural or keyword search via `POST /search`. Returns a result dict:

```rill
exa::search("rill scripting language") => $result
$result.results        # List of result dicts
$result.request_id     # Optional request identifier

# With options
exa::search("rill scripting language", [
  num_results: 5,
  include_text: true,
  type: "neural",
]) => $result
```

**contents(urls, options?)** — Fetch page contents via `POST /contents`. First param is a list of URLs:

```rill
exa::contents(["https://example.com", "https://example.org"]) => $result
$result.results    # List of content dicts
$result.statuses   # Optional per-URL status information

# With options
exa::contents(["https://example.com"], [
  include_text: true,
  include_highlights: true,
]) => $result
```

**find_similar(url, options?)** — Find pages similar to a URL via `POST /findSimilar`. Returns a result dict:

```rill
exa::find_similar("https://example.com") => $result
$result.results       # List of similar page dicts
$result.request_id    # Optional request identifier

# With options
exa::find_similar("https://example.com", [
  num_results: 10,
  exclude_source_domain: true,
]) => $result
```

**answer(query, options?)** — AI-powered answer with citations via `POST /answer`. Returns a result dict:

```rill
exa::answer("What is rill?") => $result
$result.answer      # AI-generated answer string
$result.citations   # List of source citation dicts

# With options
exa::answer("What is rill?", [
  num_results: 5,
  include_text: true,
]) => $result
```

### Per-Call Options

**search options:**

| Option | Type | Description |
|--------|------|-------------|
| `type` | string | Search type: `"neural"` or `"keyword"` |
| `num_results` | number | Number of results to return |
| `include_text` | boolean | Include full text in results |
| `include_highlights` | boolean | Include highlighted excerpts in results |
| `include_summary` | boolean | Include AI-generated summary per result |
| `category` | string | Filter by content category |
| `include_domains` | list | Restrict results to these domains |
| `exclude_domains` | list | Exclude results from these domains |
| `start_published_date` | string | Filter results published after this date |
| `end_published_date` | string | Filter results published before this date |
| `max_age_hours` | number | Filter results published within this many hours |

**contents options:**

| Option | Type | Description |
|--------|------|-------------|
| `include_text` | boolean | Include full page text (defaults true) |
| `include_highlights` | boolean | Include highlighted excerpts |
| `include_summary` | boolean | Include AI-generated summary |

**find_similar options:**

| Option | Type | Description |
|--------|------|-------------|
| `num_results` | number | Number of similar pages to return |
| `exclude_source_domain` | boolean | Exclude pages from the source URL's domain |
| `include_domains` | list | Restrict results to these domains |
| `exclude_domains` | list | Exclude results from these domains |
| `include_text` | boolean | Include full text in results |
| `include_highlights` | boolean | Include highlighted excerpts in results |

**answer options:**

| Option | Type | Description |
|--------|------|-------------|
| `include_text` | boolean | Include full text for cited sources |
| `num_results` | number | Number of source results to use |

## Result Dict

**search and find_similar results:**

| Field | Type | Description |
|-------|------|-------------|
| `results` | list | List of result dicts |
| `request_id` | string | Optional request identifier |

**contents results:**

| Field | Type | Description |
|-------|------|-------------|
| `results` | list | List of content dicts |
| `statuses` | list | Optional per-URL status information |

**answer results:**

| Field | Type | Description |
|-------|------|-------------|
| `answer` | string | AI-generated answer |
| `citations` | list | List of source citation dicts |

## Error Behavior

**Validation errors** (before API call):

- Empty query → `RuntimeError RILL-R004: exa: query is required`
- After dispose → `RuntimeError RILL-R004: exa: operation cancelled`

**API errors** (from provider):

- Rate limit → `RuntimeError RILL-R004: exa: rate limit exceeded`
- Auth failure → `RuntimeError RILL-R004: exa: authentication failed`
- Timeout → `RuntimeError RILL-R004: exa: request timeout`

## Events

| Event | Emitted When |
|-------|-------------|
| `exa:search` | search() completes successfully |
| `exa:contents` | contents() completes successfully |
| `exa:find_similar` | find_similar() completes successfully |
| `exa:answer` | answer() completes successfully |
| `exa:error` | Any operation fails |

### Event Fields

Success events (`exa:search`, `exa:contents`, `exa:find_similar`, `exa:answer`) include:

| Field | Description |
|-------|-------------|
| `duration` | Request duration in ms |
| `query` | The query or URL used for the request |
| `result_count` | Number of results returned |

Error events (`exa:error`) include:

| Field | Description |
|-------|-------------|
| `duration` | Request duration in ms |
| `error` | Error message string |

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
