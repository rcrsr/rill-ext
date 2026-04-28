# openai Extension

*OpenAI API integration for rill scripts*

This extension allows rill scripts to access OpenAI's GPT and embedding APIs. The host declares it in `rill-config.json`, and scripts load it with `use<ext:openai>`. Switching to Anthropic or Google means changing the extension mount. Scripts stay identical.

Six functions cover the core LLM operations. `message` sends a single prompt. `messages` continues a multi-turn conversation. `embed` and `embed_batch` generate vector embeddings — OpenAI offers `text-embedding-3-small` and `text-embedding-3-large` for this. `tool_loop` runs an agentic loop where the model calls rill closures as tools. `generate` extracts structured output matching a schema dict. `message`, `messages`, and `tool_loop` return a `RillStream` value. Iterate chunks with `-> each` or resolve immediately with `()` to get the result dict. `generate` returns a dict directly (no streaming). `embed` and `embed_batch` return dicts directly.

The host sets API key, model, and temperature at creation time — scripts never handle credentials. Each call emits a structured event (`openai:message`, `openai:tool_call`) for host-side logging and metrics.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "openai": "@rcrsr/rill-ext-openai"
    },
    "config": {
      "openai": {
        "api_key": "${OPENAI_API_KEY}",
        "model": "gpt-4o"
      }
    }
  }
}
```

Rill script — stream chunks:

```rill
use<ext:openai> => $llm
$llm.message("Explain TCP handshakes") => $s
$s -> each { log }
```

Resolve immediately to access the result dict:

```rill
openai::message("Explain TCP handshakes")() => $result
$result.content -> log
```

Secondary pattern (still works, not primary):

```rill
openai::message("Explain TCP handshakes")
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "openai": {
        "api_key": "${OPENAI_API_KEY}",
        "model": "gpt-4o",
        "temperature": 0.7,
        "max_tokens": 4096,
        "system": "You are a helpful assistant.",
        "embed_model": "text-embedding-3-small",
        "base_url": "https://custom-endpoint.example.com",
        "max_retries": 3,
        "timeout": 30000
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `api_key` | string | — | API key (required) |
| `model` | string | — | Model identifier (required) |
| `temperature` | number | — | Response randomness, 0.0–2.0 |
| `max_tokens` | number | 4096 | Maximum response tokens |
| `system` | string | — | Default system prompt |
| `embed_model` | string | — | Model for embed operations |
| `base_url` | string | — | Custom API endpoint |
| `max_retries` | number | — | Retry attempts for failures |
| `timeout` | number | — | Request timeout in ms |

## Functions

**message(text, options?)** — Send a single prompt. Returns `RillStream`:

```rill
# Stream text delta chunks
openai::message("Explain TCP handshakes") => $s
$s -> each { log }

# Or resolve to result dict
openai::message("Explain TCP handshakes")() => $result
$result.content      # Response text
$result.stop_reason  # Why generation stopped
$result.usage.input  # Input tokens
$result.usage.output # Output tokens
```

**messages(messages, options?)** — Multi-turn conversation. Returns `RillStream`:

```rill
# Stream text delta chunks
[
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language."],
  [role: "user", content: "Tell me more."],
] -> openai::messages => $s
$s -> each { log }

# Or resolve to result dict
[
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language."],
  [role: "user", content: "Tell me more."],
] -> openai::messages => $s
$s() => $result
$result.content   # Latest response
$result.messages  # Full conversation history
```

**embed(text)** — Generate text embedding:

```rill
openai::embed("sample text") => $vec
$vec -> .dimensions  # Vector size
$vec.model           # Embedding model used
```

**embed_batch(texts)** — Batch embeddings:

```rill
["first text", "second text"] -> openai::embed_batch => $vectors
$vectors.len  # Number of vectors
```

**tool_loop(prompt, tools, options?)** — Agentic tool-use loop. Returns `RillStream`:

```rill
^("Get current weather for a city") |^("City name") city: string| {
  "Weather in {$city}: 72F sunny"
} => $get_weather

# Stream structured events
openai::tool_loop("What's the weather in Paris?", [
  get_weather: $get_weather,
], [max_turns: 5]) => $s
$s -> each {
  $.type    # "text_delta", "tool_call", or "tool_result"
  $.text    # available when type == "text_delta"
  $.name    # available when type == "tool_call" or "tool_result"
  $.args    # available when type == "tool_call"
  $.result  # available when type == "tool_result"
}

# Or resolve to result dict
openai::tool_loop("What's the weather in Paris?", [
  get_weather: $get_weather,
], [max_turns: 5])() => $result
$result.content  # Final response
$result.turns    # Number of LLM round-trips
```

**generate(prompt, schema, options)** — Structured output extraction:

```rill
openai::generate(
  "Extract user info: Alice, 30, active",
  dict(
    ^("Full name") name: string
    ^("Age in years") age: number
    active: bool
  )
) => $result
$result.data            # Parsed dict matching schema keys
$result.raw             # Original JSON string from model
$result.usage.input     # Input tokens
$result.usage.output    # Output tokens
```

The `schema` parameter accepts a dict type expression. Field descriptions written with `^("...")` or `^(description: "...")` map to JSON Schema `description` properties. Fields with default values become optional.

Fields using `closure` or `tuple` type are not representable in JSON Schema and throw:

```text
# Error: unsupported type for JSON Schema: closure
```

### Per-Call Options

| Option | Type | Applies To | Description |
|--------|------|-----------|-------------|
| `system` | string | message, messages, tool_loop, generate | Override system prompt |
| `max_tokens` | number | message, messages, tool_loop, generate | Override max tokens |
| `max_turns` | number | tool_loop | Limit LLM round-trips |
| `max_errors` | number | tool_loop | Consecutive error limit (default: 3) |
| `messages` | list | tool_loop, generate | Prepend conversation history |

## Streaming

`message`, `messages`, and `tool_loop` return `RillStream`. Two usage patterns:

**Iterate chunks** — process output incrementally:

```rill
openai::message("hi") => $s
$s -> each { log }
```

**Resolve immediately** — access the full result dict at once:

```rill
openai::message("hi")() => $result
$result.content -> log
```

### message / messages chunks

Each chunk is a string (text delta).

### tool_loop events

Each event is a dict with a `type` field:

| `type` | Other fields | Description |
|--------|-------------|-------------|
| `"text_delta"` | `text` | Incremental text from the model |
| `"tool_call"` | `name`, `args` | Model invoked a tool |
| `"tool_result"` | `name`, `result` | Tool returned a value |

## Result Dict

`message`, `messages`, and `tool_loop` resolve to:

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | Response text |
| `model` | string | Model identifier |
| `usage.input` | number | Input token count |
| `usage.output` | number | Output token count |
| `stop_reason` | string | Why generation stopped |
| `id` | string | Request identifier |
| `messages` | list | Conversation history |

The `tool_loop` result adds `turns` (number of LLM round-trips).

### Generate Result Dict

`generate` returns a separate dict shape:

| Field | Type | Description |
|-------|------|-------------|
| `data` | dict | Parsed JSON matching schema keys |
| `raw` | string | Original JSON string from model response |
| `model` | string | Provider model identifier |
| `usage.input` | number | Input token count |
| `usage.output` | number | Output token count |
| `stop_reason` | string | Provider stop reason string |
| `id` | string | Provider response ID |

## Error Behavior

The extension emits failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #AUTH`) or finely
(`guard #AUTH && raw.kind == 'authentication_failed'`).

`meta.provider == 'openai'` on every host-fn failure.

**Factory-time validation** (throws `RuntimeError RILL-R001`):

- `api_key is required`
- `model is required`
- `temperature must be between 0.0 and 2.0`
- `embed_model is required when calling embed()`

**Host-fn errors:**

| Failure | Atom | `meta.raw.kind` |
|---|---|---|
| Empty prompt or messages list | `#INVALID_INPUT` | `empty_prompt` / `empty_messages` |
| Message missing required `role` field | `#INVALID_INPUT` | `invalid_message_format` |
| Invalid `role` value | `#INVALID_INPUT` | `invalid_role` |
| Missing message `content` | `#INVALID_INPUT` | `missing_message_content` |
| `generate()` schema missing or non-dict | `#INVALID_INPUT` | `invalid_schema` / `invalid_schema_type` |
| `tool_loop()` `tools` missing or wrong shape | `#INVALID_INPUT` | `tools_required` / `tools_not_dict` |
| `tool_loop()` builtin used as tool | `#INVALID_INPUT` | `builtin_tool_unsupported` |
| `tool_loop()` value not callable | `#INVALID_INPUT` | `tool_not_callable` |
| `tool_loop()` tool not in dict | `#NOT_FOUND` | `unknown_tool` |
| `tool_loop()` aborted after N consecutive tool errors | `#UNAVAILABLE` | `consecutive_tool_errors` |
| `tool_loop()` cancelled via `ctx.signal` | `#TIMEOUT` | `tool_loop_cancelled` |
| `embed()` / `embed_batch()` not configured | `#UNAVAILABLE` | `feature_unavailable` |
| Authentication failed (HTTP 401) | `#AUTH` | `authentication_failed` |
| Forbidden (HTTP 403) | `#FORBIDDEN` | `forbidden` |
| Resource not found (HTTP 404) | `#NOT_FOUND` | `not_found` |
| Rate limit exceeded (HTTP 429) | `#RATE_LIMIT` | `rate_limit_exceeded` |
| Quota / credits exceeded (HTTP 402) | `#QUOTA_EXCEEDED` | `quota_exceeded` |
| Server error (HTTP 5xx) | `#UNAVAILABLE` | `server_error` |
| Request timeout / `AbortError` | `#TIMEOUT` | `request_timeout` / `request_cancelled` |
| Network connection failure (`TypeError`) | `#UNAVAILABLE` | `connection_failed` |
| `generate()` failed to parse response JSON | `#PROTOCOL` | `json_parse_failed` |
| Unexpected response format (`SyntaxError`) | `#PROTOCOL` | `unexpected_response_format` |
| Other SDK / unknown failure | `#UNAVAILABLE` | `unknown_error` |

## Events

| Event | Emitted When |
|-------|-------------|
| `openai:message` | message() completes |
| `openai:messages` | messages() completes |
| `openai:embed` | embed() completes |
| `openai:embed_batch` | embed_batch() completes |
| `openai:tool_loop` | tool_loop() completes |
| `openai:generate` | generate() completes successfully |
| `openai:tool_call` | Tool invoked during loop |
| `openai:tool_result` | Tool returns during loop |
| `openai:error` | Any operation fails |

### Completion Event Fields

Completion events (`openai:message`, `openai:messages`, `openai:tool_loop`, `openai:generate`) include these fields:

| Field | Description |
|-------|-------------|
| `duration` | Request duration in milliseconds (`total_duration` for `tool_loop`) |
| `model` | Model identifier used for the request |
| `usage` | Token usage object (`input` and `output` counts) |
| `request` | Messages array sent to the provider API |
| `content` | Response text from the provider |

## OpenAI-Compatible Providers

This extension works with any OpenAI-compatible API. Set `base_url` in config to point at the provider's endpoint. Set `api_key` to that provider's key. Set `model` to a model name the provider accepts.

```json
{
  "extensions": {
    "config": {
      "openai": {
        "api_key": "${GROQ_API_KEY}",
        "model": "llama-3.3-70b-versatile",
        "base_url": "https://api.groq.com/openai/v1"
      }
    }
  }
}
```

Compatible providers include Groq, Together AI, Fireworks AI, and others that implement the OpenAI chat completions API.

### Known Limitations

Not all providers support every OpenAI API feature. Test the specific feature set you need before deploying.

| Limitation | Affected Providers | Detail |
|------------|--------------------|--------|
| Structured outputs + tool use in one request | Groq | Cannot combine `response_format: json_schema` with tools. Use one or the other per call. |
| Strict mode (`strict: true`) | Groq | Groq does not support `strict: true`. The parameter is silently ignored. |
| Model names differ | All non-OpenAI providers | Use provider-specific model IDs (e.g., `llama-3.3-70b-versatile` for Groq). |
| Streaming + tool use | Some providers | Certain providers do not support concurrent streaming and tool calling. |
| `response_format` options | Some providers | Providers may reject or ignore unsupported `response_format` values. |

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
