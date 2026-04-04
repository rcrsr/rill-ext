# search-tavily Extension

*Tavily Search API integration for rill scripts*

Provides AI-optimized web search and URL content extraction via the Tavily Search API. Scripts call `search` or `extract` and receive structured result dicts. The extension manages request lifecycle, in-flight tracking, and clean disposal.

Use this extension when your script needs search results optimized for AI pipelines, or when you need to extract clean content from a list of URLs.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "tavily": "@rcrsr/rill-ext-tavily"
    },
    "config": {
      "tavily": {
        "apiKey": "${TAVILY_API_KEY}"
      }
    }
  }
}
```

Rill script — load the extension as a handle and call functions via dot-path:

```rill
use<ext:tavily> => $ai
$ai.search("open source LLMs") => $result
$result.results -> log
```

Call a function directly without an intermediate variable:

```rill
use<ext:tavily.search>("open source LLMs") => $result
```

Secondary pattern (still works, not primary):

```rill
tavily::search("open source LLMs") => $result
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "tavily": {
        "apiKey": "${TAVILY_API_KEY}",
        "baseUrl": "https://api.tavily.com",
        "timeout": 30000
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `apiKey` | string | — | Tavily API key (required). Sent as Bearer token in Authorization header. |
| `baseUrl` | string | `https://api.tavily.com` | Base URL override for the Tavily API. |
| `timeout` | number | `30000` | Request timeout in milliseconds. |

## Functions

### search

Performs an AI-optimized web search via `POST /search`. Returns a dict with `query`, `results`, and `response_time` fields.

```rill
tavily::search("open source LLMs") => $result
$result.results -> log
```

With options:

```rill
tavily::search("open source LLMs", [max_results: 5, include_answer: true]) => $result
$result.answer -> log
```

With images:

```rill
tavily::search("Eiffel Tower", [include_images: true]) => $result
$result.images -> log
```

**Per-Call Options:**

| Option | Type | Description |
|--------|------|-------------|
| `search_depth` | string | Search depth: `"basic"` or `"advanced"`. |
| `max_results` | number | Maximum number of results to return. |
| `topic` | string | Search topic category (e.g., `"general"`, `"news"`). |
| `time_range` | string | Time filter for results (e.g., `"day"`, `"week"`, `"month"`, `"year"`). |
| `include_answer` | boolean | Include a short AI-generated answer in the response. |
| `include_raw_content` | boolean | Include raw HTML content for each result. |
| `include_images` | boolean | Include image results in the response. |
| `include_domains` | list | Restrict results to these domains. |
| `exclude_domains` | list | Exclude results from these domains. |
| `country` | string | Country code for localized results (e.g., `"us"`, `"gb"`). |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `query` | string | The search query as submitted. |
| `results` | list | List of search result objects. |
| `response_time` | number | Time taken by the Tavily API in seconds. |
| `answer` | string | AI-generated answer. Present only when `include_answer` is set. |
| `images` | list | Image results. Present only when `include_images` is set. |

### extract

Extracts content from one or more URLs via `POST /extract`. The first parameter is a list of URL strings. Returns a dict with `results` and `failed_results` lists.

```rill
tavily::extract(["https://example.com"]) => $result
$result.results -> log
```

With options:

```rill
tavily::extract(["https://example.com", "https://another.com"], [extract_depth: "advanced", format: "markdown"]) => $result
$result.failed_results -> log
```

**Per-Call Options:**

| Option | Type | Description |
|--------|------|-------------|
| `extract_depth` | string | Extraction depth: `"basic"` or `"advanced"`. |
| `format` | string | Output format for extracted content (e.g., `"markdown"`, `"text"`). |
| `chunks_per_source` | number | Number of content chunks to return per URL. |
| `query` | string | Optional query to guide content extraction relevance. |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `results` | list | List of successfully extracted content objects. |
| `failed_results` | list | List of URLs that could not be extracted. |

## Error Behavior

| Condition | Error Code | Message |
|-----------|------------|---------|
| Empty query string | `RILL-R004` | `tavily: query is required` |
| HTTP 429 from Tavily API | `RILL-R004` | `tavily: rate limit exceeded` |
| HTTP 401 from Tavily API | `RILL-R004` | `tavily: authentication failed` |
| Request timeout | `RILL-R004` | `tavily: request timeout` |
| Called after `dispose()` | `RILL-R004` | `tavily: operation cancelled` |

## Events

The extension emits runtime events for observability. Listen with `ctx.on()` in the host application.

**Success events** (emitted after each completed request):

| Event | Fields |
|-------|--------|
| `tavily:search` | `duration` (ms), `query` (string), `result_count` (number) |
| `tavily:extract` | `duration` (ms), `query` (string), `result_count` (number) |

**Error events** (emitted when a request fails):

| Event | Fields |
|-------|--------|
| `tavily:error` | `duration` (ms), `error` (string) |

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
