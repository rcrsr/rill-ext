# search-brave Extension

*Brave Search API integration for rill scripts*

Provides web search, news search, and AI-powered summarization via the Brave Search API. Scripts call `search`, `news`, or `summarize` functions and receive structured result dicts. The extension manages request lifecycle, in-flight tracking, and clean disposal.

Use this extension when your script needs real-time web results, news headlines, or summarized answers from Brave's independent search index.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "brave": "@rcrsr/rill-ext-search-brave"
    },
    "config": {
      "brave": {
        "apiKey": "${BRAVE_API_KEY}"
      }
    }
  }
}
```

Rill script — load the extension as a handle and call functions via dot-path:

```rill
use<ext:brave> => $web
$web.search("open source LLMs") => $result
$result.web.results -> log
```

Call a function directly without an intermediate variable:

```rill
use<ext:brave.search>("open source LLMs") => $result
```

Secondary pattern (still works, not primary):

```rill
brave::search("open source LLMs") => $result
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "brave": {
        "apiKey": "${BRAVE_API_KEY}",
        "baseUrl": "https://api.search.brave.com",
        "timeout": 30000
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `apiKey` | string | — | Brave Search API key (required). Sent as `X-Subscription-Token` header. |
| `baseUrl` | string | `https://api.search.brave.com` | Base URL override for the Brave Search API. |
| `timeout` | number | `30000` | Request timeout in milliseconds. |

## Functions

### search

Performs a web search via `GET /res/v1/web/search`. Returns a dict with `query` and `web` fields.

```rill
brave::search("open source LLMs") => $result
$result.web.results -> log
```

With options:

```rill
brave::search("open source LLMs", [count: 5, country: "US", freshness: "pw"]) => $result
```

**Per-Call Options:**

| Option | Type | Description |
|--------|------|-------------|
| `count` | number | Number of results to return. |
| `offset` | number | Offset into the result list for pagination. |
| `country` | string | Country code for localized results (e.g., `"US"`, `"DE"`). |
| `search_lang` | string | Language code for results (e.g., `"en"`, `"fr"`). |
| `freshness` | string | Time filter: `"pd"` (day), `"pw"` (week), `"pm"` (month), or date range. |
| `safesearch` | string | Safe search level: `"off"`, `"moderate"`, or `"strict"`. |
| `extra_snippets` | boolean | Include extra text snippets in results. |
| `goggles` | string | Goggle URL to apply custom re-ranking. |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `query` | dict | Metadata about the query as returned by Brave. |
| `web` | dict | Web result container. `web.results` holds the result list. |

### news

Performs a news search via `GET /res/v1/news/search`. Returns a dict with a `results` list.

```rill
brave::news("AI regulation") => $result
$result.results -> log
```

With options:

```rill
brave::news("AI regulation", [count: 10, country: "GB", freshness: "pd"]) => $result
```

**Per-Call Options:**

| Option | Type | Description |
|--------|------|-------------|
| `count` | number | Number of results to return. |
| `offset` | number | Offset into the result list for pagination. |
| `country` | string | Country code for localized results (e.g., `"US"`, `"GB"`). |
| `search_lang` | string | Language code for results (e.g., `"en"`, `"fr"`). |
| `freshness` | string | Time filter: `"pd"` (day), `"pw"` (week), `"pm"` (month), or date range. |
| `safesearch` | string | Safe search level: `"off"`, `"moderate"`, or `"strict"`. |
| `extra_snippets` | boolean | Include extra text snippets in results. |
| `goggles` | string | Goggle URL to apply custom re-ranking. |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `results` | list | List of news result objects. |

### summarize

Performs a 2-step summarizer flow: first fetches a summarizer key via web search, then retrieves the generated summary. Returns a dict with `summary`, `title`, `followups`, and `context`.

**Note:** The Brave Summarizer API is deprecated in favor of the Brave Answers API.

```rill
brave::summarize("how does RLHF work") => $result
$result.summary -> log
```

With options:

```rill
brave::summarize("how does RLHF work", [country: "US", search_lang: "en"]) => $result
```

**Per-Call Options:**

| Option | Type | Description |
|--------|------|-------------|
| `count` | number | Number of web results to include in the summarizer context. |
| `country` | string | Country code for localized context (e.g., `"US"`). |
| `search_lang` | string | Language code for context (e.g., `"en"`). |
| `safesearch` | string | Safe search level: `"off"`, `"moderate"`, or `"strict"`. |

**Result Dict:**

| Field | Type | Description |
|-------|------|-------------|
| `summary` | string | Generated summary text. |
| `title` | string | Title for the summarized answer. |
| `followups` | list | Suggested follow-up questions. |
| `context` | list | Source context used to generate the summary. |

## Error Behavior

The extension emits failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #FORBIDDEN`) or finely
(`guard #FORBIDDEN && raw.kind == 'access_denied'`).

**Host-fn errors:**

| Failure | Atom | `meta.raw.kind` |
|---|---|---|
| Empty / missing query | `#INVALID_INPUT` | `empty_query` |
| Summarizer key not in initial response | `#UNAVAILABLE` | `summarizer_key_missing` |
| Summarizer second request failed | `#UNAVAILABLE` | `summarizer_request_failed` |
| Authentication failed (HTTP 401) | `#AUTH` | `authentication_failed` |
| Access denied — body carries provider code (HTTP 403) | `#FORBIDDEN` | `access_denied` |
| Forbidden — no body code (HTTP 403) | `#FORBIDDEN` | `forbidden` |
| Resource not found (HTTP 404) | `#NOT_FOUND` | `not_found` |
| Rate limit exceeded (HTTP 429) | `#RATE_LIMIT` | `rate_limit_exceeded` |
| Server error (HTTP 5xx) | `#UNAVAILABLE` | `server_error` |
| Request timeout / `AbortError` | `#TIMEOUT` | `request_timeout` |
| Network connection failure (`TypeError`) | `#UNAVAILABLE` | `connection_failed` |
| Unexpected response format (`SyntaxError`) | `#PROTOCOL` | `unexpected_response_format` |
| Called after `dispose()` | `#DISPOSED` | `disposed` |

## Events

The extension emits runtime events for observability. Listen with `ctx.on()` in the host application.

**Success events** (emitted after each completed request):

| Event | Fields |
|-------|--------|
| `brave:search` | `duration` (ms), `query` (string), `result_count` (number) |
| `brave:news` | `duration` (ms), `query` (string), `result_count` (number) |
| `brave:summarize` | `duration` (ms), `query` (string), `result_count` (number) |

**Error events** (emitted when a request fails):

| Event | Fields |
|-------|--------|
| `brave:error` | `duration` (ms), `error` (string) |

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
