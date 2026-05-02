# openai Extension

*OpenAI API integration for rill scripts*

This extension allows rill scripts to access OpenAI's GPT, o-series, and embedding APIs. The host declares it in `rill-config.json`, and scripts load it with `use<ext:openai>`. Switching to Anthropic or Google means changing the extension mount. Scripts stay identical.

Five functions cover the core LLM operations. `message` sends a single prompt or multi-turn conversation. `embed` and `embed_batch` generate vector embeddings — OpenAI offers `text-embedding-3-small` and `text-embedding-3-large` for this. `tool_loop` runs an agentic loop where the model calls rill closures as tools. `generate` extracts structured output matching a schema dict. `message` and `tool_loop` return a `RillStream` value. Iterate chunks with `-> each` or resolve immediately with `()` to get the result dict. `generate` returns a dict directly (no streaming). `embed` and `embed_batch` return dicts directly.

The host sets API key, model, and temperature at creation time — scripts never handle credentials. Each call emits a structured event (`openai:message`, `openai:tool_call`) for host-side logging and metrics.

## Migration: `messages` verb removed

The `messages` verb no longer exists. Pass a list to `message` instead:

```rill
# Before (no longer valid)
[
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language."],
  [role: "user", content: "Tell me more."],
] -> openai::messages

# After
openai::message([
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language."],
  [role: "user", content: "Tell me more."],
])
```

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
$result.messages[last].parts[0].text -> log
```

## Model-Class Routing

The extension detects the model class once at factory init and fixes the API path for the instance lifetime.

| Model pattern | API path |
|---------------|----------|
| `o1`, `o3`, `o4-mini`, `o1-mini`, `o1-preview`, etc. (matches `^o\d`) | Responses API (`client.responses`) |
| All other models (`gpt-*`, `text-*`, etc.) | Chat Completions API (`client.chat.completions`) |

Routing does not change per call. To switch from a standard model to an o-series model, create a new extension instance with the new model.

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
        "timeout": 30000,
        "max_turns": 10,
        "max_errors": 3,
        "extra": {
          "user": "user-123"
        }
      }
    }
  }
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `api_key` | string | — | API key (required) |
| `model` | string | — | Model identifier (required); determines API path at factory init |
| `temperature` | number | — | Response randomness, 0.0–2.0 |
| `max_tokens` | number | 4096 | Maximum response tokens |
| `system` | string | — | Default system prompt |
| `embed_model` | string | — | Model for embed operations |
| `base_url` | string | — | Custom API endpoint |
| `max_retries` | number | — | Retry attempts for failures |
| `timeout` | number | — | Request timeout in ms |
| `max_turns` | number | — | Maximum tool-loop turns per instance; must be a positive integer; `0` is rejected at factory init |
| `max_errors` | number | 3 | Maximum consecutive tool errors before loop aborts; must be a positive integer |
| `extra` | dict | — | Additional OpenAI API fields forwarded verbatim; must not contain reserved keys (see below) |

### Factory Validation Rules

| Field | Validation |
|-------|-----------|
| `max_turns` | Must be `undefined` or a positive integer. `0` is rejected with "sentinel value not allowed for factory max_turns". Negative values are rejected. |
| `max_errors` | Must be `undefined` or a positive integer. |
| `extra` | Keys must not appear in the reserved set. Violation throws `RuntimeError RILL-R001` at factory init. |

### Reserved Keys (`extra` must not contain)

The `extra` dict may not contain any key in the OpenAI reserved superset — the union of `RESERVED_KEYS_COMMON` and OpenAI-specific fields:

`messages`, `model`, `system`, `temperature`, `max_tokens`, `stream`, `response_format`, `tools`, `tool_choice`, `function_call`, `functions`, `input`, `instructions`, `previous_response_id`, `reasoning`

The superset covers both the Chat Completions and Responses API so that `extra` config remains portable when the model is switched between standard and o-series.

### `extra` Forwarding Mechanism

`extra` fields are spread directly into the first-arg params dict passed to the OpenAI SDK (openai v6 mechanism). In v6 the `extra_body` field on `RequestOptions` was removed. Extra fields instead merge into the request body via object spread:

```typescript
client.chat.completions.stream({
  model: ...,
  messages: ...,
  ...(factoryExtra ?? {}),   // extra spread here
})
```

This means every key in `extra` appears as a top-level field in the JSON body sent to the API.

## Functions

**message(prompt)** — Send a single prompt or multi-turn conversation. Returns `RillStream`:

The `prompt` parameter accepts either a string or a list of message dicts.

```rill
# String prompt — single user turn
openai::message("Explain TCP handshakes") => $s
$s -> each { log }

# List prompt — multi-turn conversation
openai::message([
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language."],
  [role: "user", content: "Tell me more."],
]) => $s
$s -> each { log }

# Resolve immediately to access the result dict
openai::message("Explain TCP handshakes")() => $result
$result.stop_reason  # Why generation stopped
$result.usage.input  # Input tokens
$result.usage.output # Output tokens
```

Message dicts accept two shapes. The content-sugar form `[role: "user", content: "text"]` expands to parts form automatically.

```rill
# Parts form (canonical)
[role: "user", parts: [[type: "text", text: "Hello"]]]

# Content-sugar form (accepted; expanded internally)
[role: "user", content: "Hello"]
```

**embed(text)** — Generate text embedding:

```rill
openai::embed("sample text") => $vec
```

**embed_batch(texts)** — Batch embeddings:

```rill
["first text", "second text"] -> openai::embed_batch => $vectors
```

**tool_loop(prompt, tools, max_turns)** — Agentic tool-use loop. Returns `RillStream`:

The `max_turns` parameter is positional (not an options dict). Default value `0` means use the factory `max_turns`. Pass a positive integer to override for a specific call.

```rill
^("Get current weather for a city") |^("City name") city: string| {
  "Weather in {$city}: 72F sunny"
} => $get_weather

# Stream structured events
openai::tool_loop("What's the weather in Paris?", [
  get_weather: $get_weather,
], 5) => $s
$s -> each {
  $.type    # "text_delta", "tool_call", or "tool_result"
  $.text    # available when type == "text_delta"
  $.name    # available when type == "tool_call" or "tool_result"
  $.args    # available when type == "tool_call"
  $.result  # available when type == "tool_result"
}

# Resolve to result dict (default max_turns from factory)
openai::tool_loop("What's the weather in Paris?", [
  get_weather: $get_weather,
], 0)() => $result
$result.turns    # Number of LLM round-trips
```

**generate(prompt, schema)** — Structured output extraction:

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

## Streaming

`message` and `tool_loop` return `RillStream`. Two usage patterns:

**Iterate chunks** — process output incrementally:

```rill
openai::message("hi") => $s
$s -> each { log }
```

**Resolve immediately** — access the full result dict at once:

```rill
openai::message("hi")() => $result
$result.messages[last].parts[0].text -> log
```

### message chunks

Each chunk is a string (text delta).

### tool_loop events

Each event is a dict with a `type` field:

| `type` | Other fields | Description |
|--------|-------------|-------------|
| `"text_delta"` | `text` | Incremental text from the model |
| `"tool_call"` | `name`, `args` | Model invoked a tool |
| `"tool_result"` | `name`, `result` | Tool returned a value |

## Result Dict

`message` and `tool_loop` resolve to a dict with parts-shaped message history:

| Field | Type | Description |
|-------|------|-------------|
| `model` | string | Model identifier used for the request |
| `usage` | dict | Token counts: `input` (number), `output` (number) |
| `stop_reason` | string | Why generation stopped |
| `id` | string | Provider request identifier |
| `messages` | list | Conversation history — list of message dicts |

Each message dict in `messages`:

| Field | Type | Description |
|-------|------|-------------|
| `role` | string | `"user"` or `"assistant"` |
| `parts` | list | List of part dicts |

Each part dict carries a `type` discriminator. Part variants:

| `type` | Additional fields | Description |
|--------|------------------|-------------|
| `text` | `text: string` | Text content |
| `thinking` | `text: string` | Reasoning text (o-series Responses API) |
| `tool_use` | `id: string`, `name: string`, `input: dict` | Tool invocation by assistant |
| `tool_result` | `id: string`, `parts: list` | Tool result in user turn |
| `image` | `source: dict` | Image content |

Image `source` dict fields: `kind` (`"base64"` or `"url"`), `data` (string), `media_type` (string).

**Security note:** When `source.kind` is `"url"`, the extension passes the URL directly to the OpenAI API. The extension does not validate or proxy the URL. Callers are responsible for ensuring the URL does not point to internal network resources (SSRF mitigation).

The `tool_loop` result adds:

| Field | Type | Description |
|-------|------|-------------|
| `turns` | number | Number of LLM round-trips executed |

### Generate Result Dict

`generate` returns a separate dict shape:

| Field | Type | Description |
|-------|------|-------------|
| `data` | dict | Parsed JSON matching schema keys |
| `raw` | string | Original JSON string from model response |
| `messages` | list | Conversation history (same shape as above) |
| `model` | string | Provider model identifier |
| `usage` | dict | Token counts: `input` (number), `output` (number) |
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
- `max_turns: 0 is the sentinel value — use undefined for no cap`
- `max_turns must be a positive integer`
- `extra contains reserved key: <key>`

**Host-fn errors:**

| Failure | Atom | `meta.raw.kind` |
|---|---|---|
| Empty prompt or messages list | `#INVALID_INPUT` | `empty_prompt` / `empty_messages` |
| Message missing required `role` field | `#INVALID_INPUT` | `invalid_message_format` |
| Invalid `role` value | `#INVALID_INPUT` | `invalid_role` |
| Missing message `content` or `parts` | `#INVALID_INPUT` | `missing_message_content` |
| `generate()` schema missing or non-dict | `#INVALID_INPUT` | `invalid_schema` / `invalid_schema_type` |
| `tool_loop()` `tools` missing or wrong shape | `#INVALID_INPUT` | `tools_required` / `tools_not_dict` |
| `tool_loop()` builtin used as tool | `#INVALID_INPUT` | `builtin_tool_unsupported` |
| `tool_loop()` value not callable | `#INVALID_INPUT` | `tool_not_callable` |
| `tool_loop()` `max_turns` arg < 0 | `#INVALID_INPUT` | `invalid_max_turns` |
| `tool_loop()` empty tools dict | `#INVALID_INPUT` | `empty_tools_dict` |
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
| `openai:embed` | embed() completes |
| `openai:embed_batch` | embed_batch() completes |
| `openai:tool_loop` | tool_loop() completes |
| `openai:generate` | generate() completes successfully |
| `openai:tool_call` | Tool invoked during loop |
| `openai:tool_result` | Tool returns during loop |
| `openai:error` | Any operation fails |

### Completion Event Fields

Completion events (`openai:message`, `openai:tool_loop`, `openai:generate`) include these fields:

| Field | Description |
|-------|-------------|
| `duration` | Request duration in milliseconds (`total_duration` for `tool_loop`) |
| `model` | Model identifier used for the request |
| `usage` | Token usage object (`input` and `output` counts) |

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
