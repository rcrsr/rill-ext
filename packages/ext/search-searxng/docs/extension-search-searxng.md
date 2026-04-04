# searxng Extension

*Self-hosted meta-search for rill scripts*

Provides web search through a self-hosted SearXNG instance. Unlike other search extensions, no API key is required. The host configures a `baseUrl` pointing to the instance. The factory probes `/config` at creation time to verify JSON format availability. Scripts call `search` to query the instance and `config` to inspect instance capabilities.

Use SearXNG when your deployment requires on-premise search, privacy, or zero external API cost. Each call emits a structured event (`searxng:search`, `searxng:config`) for host-side logging and metrics.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "searxng": "@rcrsr/rill-ext-search-searxng"
    },
    "config": {
      "searxng": {
        "baseUrl": "https://searxng.example.com"
      }
    }
  }
}
```

Rill script — load the extension as a handle and call search via dot-path:

```rill
use<ext:searxng> => $meta
$meta.search("rill scripting language") => $res
$res.results -> log
```

Pass per-call options:

```rill
searxng::search("rill scripting language", [categories: "general", language: "en"]) => $res
$res.number_of_results -> log
```

Fetch instance configuration:

```rill
searxng::config() => $cfg
$cfg.engines -> log
```

Secondary pattern (still works, not primary):

```rill
searxng::search("open source runtimes")
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "searxng": {
        "baseUrl": "https://searxng.example.com",
        "timeout": 30000
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `baseUrl` | string | — | SearXNG instance base URL (required) |
| `timeout` | number | `30000` | Request timeout in ms |

**Environment variable substitution:**

```json
{
  "extensions": {
    "config": {
      "searxng": {
        "baseUrl": "${SEARXNG_URL}"
      }
    }
  }
}
```

## Functions

**search(query, options?)** — Query the instance via `GET /search?format=json`. Returns a dict:

```rill
searxng::search("open source search engines") => $res
$res.query            # Echoed query string
$res.number_of_results # Total result count reported by instance
$res.results          # List of result dicts
$res.suggestions      # Suggested queries (present when instance returns them)
$res.answers          # Direct answers (present when instance returns them)
$res.infoboxes        # Knowledge boxes (present when instance returns them)
$res.corrections      # Spelling corrections (present when instance returns them)
```

Pass options to narrow the search:

```rill
searxng::search("rust programming", [
  categories: "it",
  engines: "google,bing",
  language: "en",
  pageno: 2,
  safesearch: 1,
  time_range: "month",
]) => $res
$res.results -> each { $.title -> log }
```

**config()** — Fetch instance configuration via `GET /config`. No parameters. Returns a dict:

```rill
searxng::config() => $cfg
$cfg.categories -> log
$cfg.engines    -> log
$cfg.plugins    -> log
$cfg.locales    -> log
```

### Per-Call Options

| Option | Type | Description |
|--------|------|-------------|
| `categories` | string | Comma-separated category names (e.g. `"general,it"`) |
| `engines` | string | Comma-separated engine names (e.g. `"google,bing"`) |
| `language` | string | Language code (e.g. `"en"`, `"de"`) |
| `pageno` | number | Result page number (1-based) |
| `safesearch` | number | Safe-search level: `0` off, `1` moderate, `2` strict |
| `time_range` | string | Restrict by age: `"day"`, `"month"`, or `"year"` only |

### Result Dict

`search` returns:

| Field | Type | Always Present | Description |
|-------|------|---------------|-------------|
| `query` | string | Yes | The query string sent to the instance |
| `number_of_results` | number | Yes | Total results reported (may be 0) |
| `results` | list | Yes | List of result dicts from the instance |
| `suggestions` | list | No | Query suggestions when provided by instance |
| `answers` | list | No | Direct answers when provided by instance |
| `infoboxes` | list | No | Knowledge infoboxes when provided by instance |
| `corrections` | list | No | Spelling corrections when provided by instance |

`config` returns:

| Field | Type | Description |
|-------|------|-------------|
| `categories` | list | Available search categories |
| `engines` | list | Configured engine list |
| `plugins` | list | Installed plugins |
| `locales` | list | Supported locales |

## Error Behavior

**Validation errors** (before request):

- Empty query → `RuntimeError RILL-R004: searxng: query is required`
- Invalid `time_range` value → `RuntimeError RILL-R004: searxng: time_range must be one of: day, month, year`
- After dispose → `RuntimeError RILL-R004: searxng: operation cancelled`

**Factory errors** (at creation time):

- Instance unreachable → `RuntimeError RILL-R004: searxng: instance unreachable at {url}`
- JSON format not enabled → `RuntimeError RILL-R004: searxng: JSON format is not enabled on {url}`

**Request errors** (during call):

- Network failure → `RuntimeError RILL-R004: searxng: connection failed`
- Non-2xx response → `RuntimeError RILL-R004: searxng: server error ({status})`
- Malformed JSON body → `RuntimeError RILL-R004: searxng: unexpected response format`

## Events

| Event | Emitted When |
|-------|-------------|
| `searxng:search` | `search()` completes successfully |
| `searxng:config` | `config()` completes successfully |
| `searxng:error` | Any operation fails |

### Completion Event Fields

Success events (`searxng:search`, `searxng:config`) include:

| Field | Description |
|-------|-------------|
| `duration` | Request duration in ms |
| `query` | Query string sent (or `"config"` for config calls) |
| `result_count` | Number of results in the response |

Error events (`searxng:error`) include:

| Field | Description |
|-------|-------------|
| `duration` | Duration in ms before failure |
| `error` | Error message string |

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
