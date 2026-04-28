# serper Extension

*Google Search API integration for rill scripts via Serper*

This extension allows rill scripts to run Google searches using the Serper API. The host declares it in `rill-config.json`, and scripts load it with `use<ext:serper>`. Switching to a different search provider means changing the extension mount. Scripts stay identical.

Three functions cover Google search types. `search` runs a standard web search and returns organic results plus optional rich features. `news` retrieves Google News results. `images` retrieves Google Image results with size and source metadata.

The host sets the API key and base URL at creation time — scripts never handle credentials. Each call emits a structured event (`serper:search`, `serper:news`, `serper:images`) for host-side logging and metrics.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "serper": "@rcrsr/rill-ext-search-serper"
    },
    "config": {
      "serper": {
        "apiKey": "${SERPER_API_KEY}"
      }
    }
  }
}
```

Rill script — load the extension as a handle and call functions via dot-path:

```rill
use<ext:serper> => $google
$google.search("rill scripting language") => $result
$result.organic -> log
```

Direct dot-path — no intermediate variable:

```rill
use<ext:serper.search>("rill scripting language") => $result
$result.organic -> log
```

Secondary pattern (still works, not primary):

```rill
serper::search("rill scripting language")
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "serper": {
        "apiKey": "${SERPER_API_KEY}",
        "baseUrl": "https://google.serper.dev",
        "timeout": 30000
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `apiKey` | string | — | Serper API key (required) |
| `baseUrl` | string | `"https://google.serper.dev"` | API base URL |
| `timeout` | number | `30000` | Request timeout in ms |

## Functions

**search(query, options?)** — Google web search via POST /search:

```rill
serper::search("open source LLM frameworks") => $result
$result.search_parameters -> log
$result.organic -> log

# With per-call options
serper::search("TypeScript tutorial", [num: 10, gl: "us", hl: "en"]) => $result
$result.organic -> log

# Optional rich fields (present when Serper returns them)
$result.answer_box      # Featured answer snippet
$result.knowledge_graph # Knowledge panel data
$result.people_also_ask # Related questions list
$result.related_searches # Related search terms list
```

**news(query, options?)** — Google News search via POST /news:

```rill
serper::news("tech news") => $result
$result.news -> log

# With per-call options
serper::news("AI research", [num: 5, gl: "us", hl: "en"]) => $result
$result.news -> log
```

**images(query, options?)** — Google Image search via POST /images:

```rill
serper::images("cats") => $result
$result.images -> log

# Access image metadata
serper::images("sunset photography", [num: 10]) => $result
$result.images -> each {
  $.title
  $.imageUrl
  $.imageWidth
  $.imageHeight
  $.thumbnailUrl
  $.source
  $.link
}
```

### Per-Call Options

| Option | Type | Applies To | Description |
|--------|------|-----------|-------------|
| `num` | number | search, news, images | Number of results to return |
| `page` | number | search | Page number for pagination |
| `gl` | string | search, news, images | Country code (e.g., `"us"`, `"gb"`) |
| `hl` | string | search, news, images | Language code (e.g., `"en"`, `"de"`) |
| `tbs` | string | search, news | Time-based filter (e.g., `"qdr:d"` for past day) |
| `autocorrect` | boolean | search | Enable query autocorrection |
| `safe` | string | search | Safe search setting |
| `location` | string | search | Geographic location string |

## Result Dict

**search** returns:

| Field | Type | Description |
|-------|------|-------------|
| `search_parameters` | dict | Echo of request parameters |
| `organic` | list | Organic search result items |
| `answer_box` | dict | Featured answer snippet (optional) |
| `knowledge_graph` | dict | Knowledge panel data (optional) |
| `people_also_ask` | list | Related questions (optional) |
| `related_searches` | list | Related search terms (optional) |

**news** returns:

| Field | Type | Description |
|-------|------|-------------|
| `news` | list | News result items |

**images** returns:

| Field | Type | Description |
|-------|------|-------------|
| `images` | list | Image result items |

Each item in `images` contains:

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Image title |
| `imageUrl` | string | Full-size image URL |
| `imageWidth` | number | Image width in pixels |
| `imageHeight` | number | Image height in pixels |
| `thumbnailUrl` | string | Thumbnail image URL |
| `source` | string | Source domain |
| `link` | string | Page URL containing the image |

## Error Behavior

The extension emits failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #RATE_LIMIT`) or finely
(`guard #RATE_LIMIT && raw.kind == 'rate_limit_exceeded'`).

**Host-fn errors:**

| Failure | Atom | `meta.raw.kind` |
|---|---|---|
| Empty / missing required input (e.g. `query`) | `#INVALID_INPUT` | `invalid_input` |
| Authentication failed (HTTP 401) | `#AUTH` | `authentication_failed` |
| Forbidden (HTTP 403) | `#FORBIDDEN` | `forbidden` |
| Resource not found (HTTP 404) | `#NOT_FOUND` | `not_found` |
| Rate limit exceeded (HTTP 429) | `#RATE_LIMIT` | `rate_limit_exceeded` |
| Quota exceeded (HTTP 402) | `#QUOTA_EXCEEDED` | `quota_exceeded` |
| Server error (HTTP 5xx) | `#UNAVAILABLE` | `server_error` |
| Request timeout / `AbortError` | `#TIMEOUT` | `request_timeout` |
| Network connection failure (`TypeError`) | `#UNAVAILABLE` | `connection_failed` |
| Unexpected response format (`SyntaxError`) | `#PROTOCOL` | `unexpected_response_format` |
| Called after `dispose()` | `#DISPOSED` | `disposed` |

## Events

| Event | Emitted When |
|-------|-------------|
| `serper:search` | search() completes successfully |
| `serper:news` | news() completes successfully |
| `serper:images` | images() completes successfully |
| `serper:error` | Any operation fails |

### Success Event Fields

Completion events (`serper:search`, `serper:news`, `serper:images`) include these fields:

| Field | Description |
|-------|-------------|
| `duration` | Request duration in milliseconds |
| `query` | Search query string |
| `result_count` | Number of results returned |

### Error Event Fields

| Field | Description |
|-------|-------------|
| `duration` | Request duration in milliseconds |
| `error` | Error message string |

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
