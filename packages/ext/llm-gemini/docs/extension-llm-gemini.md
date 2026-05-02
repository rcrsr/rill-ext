# gemini Extension

*Gemini API integration for rill scripts*

This extension allows rill scripts to access the Gemini API using the `@google/genai` SDK (preview). The host declares it in `rill-config.json`, and scripts load it with `use<ext:gemini>`. Switching to Anthropic or OpenAI means changing the extension mount. Scripts stay identical.

Five functions cover the core LLM operations. `message` sends a single prompt or multi-turn conversation. `embed` and `embed_batch` generate vector embeddings. `tool_loop` runs an agentic loop where the model calls rill closures as tools. `generate` extracts structured data as a typed dict. `message` and `tool_loop` return a `RillStream` value. Iterate chunks with `-> each` or resolve immediately with `()` to get the result dict. `generate` returns a dict directly (no streaming). `embed` and `embed_batch` return dicts directly. Google's API returns 0 for token counts and empty string for request IDs — see [Provider Notes](#provider-notes) for details.

The host sets API key, model, and temperature at creation time — scripts never handle credentials. Each call emits a structured event (`gemini:message`, `gemini:tool_call`) for host-side logging and metrics.

## Migration: `messages` verb removed

The `messages` verb no longer exists. Pass a list to `message` instead:

```rill
# Before (no longer valid)
[
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language."],
  [role: "user", content: "Tell me more."],
] -> gemini::messages

# After
gemini::message([
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
      "gemini": "@rcrsr/rill-ext-gemini"
    },
    "config": {
      "gemini": {
        "api_key": "${GEMINI_API_KEY}",
        "model": "gemini-2.0-flash"
      }
    }
  }
}
```

Rill script — stream chunks:

```rill
use<ext:gemini> => $llm
$llm.message("Explain TCP handshakes") => $s
$s -> each { log }
```

Resolve immediately to access the result dict:

```rill
gemini::message("Explain TCP handshakes")() => $result
$result.messages[last].parts[0].text -> log
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "gemini": {
        "api_key": "${GEMINI_API_KEY}",
        "model": "gemini-2.0-flash",
        "temperature": 0.7,
        "max_tokens": 8192,
        "system": "You are a helpful assistant.",
        "embed_model": "text-embedding-004",
        "base_url": "https://custom-endpoint.example.com",
        "max_retries": 3,
        "timeout": 30000,
        "max_turns": 10,
        "max_errors": 3,
        "extra": {
          "topK": 40
        }
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
| `max_tokens` | number | 8192 | Maximum response tokens |
| `system` | string | — | Default system prompt |
| `embed_model` | string | — | Model for embed operations |
| `base_url` | string | — | Custom API endpoint |
| `max_retries` | number | — | Retry attempts for failures |
| `timeout` | number | — | Request timeout in ms |
| `max_turns` | number | — | Maximum tool-loop turns per instance; must be a positive integer; `0` is rejected at factory init |
| `max_errors` | number | 3 | Maximum consecutive tool errors before loop aborts; must be a positive integer |
| `extra` | dict | — | Additional Gemini generation config fields merged verbatim; must not contain reserved keys (see below) |

### Factory Validation Rules

| Field | Validation |
|-------|-----------|
| `max_turns` | Must be `undefined` or a positive integer. `0` is rejected with "sentinel value not allowed for factory max_turns". Negative values are rejected. |
| `max_errors` | Must be `undefined` or a positive integer. |
| `extra` | Keys must not appear in the reserved set. Violation throws `RuntimeError RILL-R001` at factory init. |

### Reserved Keys (`extra` must not contain)

The `extra` dict may not contain any key in the Gemini reserved superset — `RESERVED_KEYS_COMMON` plus Gemini-specific fields:

`messages`, `model`, `system`, `temperature`, `max_tokens`, `stream`, `response_format`, `contents`, `systemInstruction`

`contents` and `systemInstruction` are the Gemini SDK fields the extension sets directly when building each API request.

### `extra` Forwarding Mechanism

`extra` fields merge into the `generationConfig` object passed to the Gemini SDK. The extension builds a `generationConfig` dict from the factory config fields (`maxOutputTokens`, `temperature`, `systemInstruction`, `responseSchema`, `responseMimeType`) and then overlays each `extra` key on top:

```typescript
// Simplified illustration
const generationConfig = {
  maxOutputTokens: factoryMaxTokens,
  temperature: factoryTemperature,
  ...factoryExtra,   // extra merged here
};
client.models.generateContentStream({ model, contents, config: generationConfig });
```

This means `extra` fields like `topK`, `topP`, `candidateCount`, and other `GenerationConfig` fields supported by the Gemini SDK can be set via `extra`.

## Functions

**message(prompt)** — Send a single prompt or multi-turn conversation. Returns `RillStream`:

The `prompt` parameter accepts either a string or a list of message dicts.

```rill
# String prompt — single user turn
gemini::message("Explain TCP handshakes") => $s
$s -> each { log }

# List prompt — multi-turn conversation
gemini::message([
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language."],
  [role: "user", content: "Tell me more."],
]) => $s
$s -> each { log }

# Resolve immediately to access the result dict
gemini::message("Explain TCP handshakes")() => $result
$result.stop_reason  # Why generation stopped
$result.usage.input  # Input tokens (always 0; see Provider Notes)
$result.usage.output # Output tokens (always 0; see Provider Notes)
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
gemini::embed("sample text") => $vec
```

**embed_batch(texts)** — Batch embeddings:

```rill
["first text", "second text"] -> gemini::embed_batch => $vectors
```

**tool_loop(prompt, tools, max_turns)** — Agentic tool-use loop. Returns `RillStream`:

The `max_turns` parameter is positional (not an options dict). Default value `0` means use the factory `max_turns`. Pass a positive integer to override for a specific call.

```rill
^("Get current weather for a city") |^("City name") city: string| {
  "Weather in {$city}: 72F sunny"
} => $get_weather

# Stream structured events
gemini::tool_loop("What's the weather in Paris?", [get_weather: $get_weather], 5) => $s
$s -> each {
  $.type    # "text_delta", "tool_call", or "tool_result"
  $.text    # available when type == "text_delta"
  $.name    # available when type == "tool_call" or "tool_result"
  $.args    # available when type == "tool_call"
  $.result  # available when type == "tool_result"
}

# Resolve to result dict (default max_turns from factory)
gemini::tool_loop("What's the weather in Paris?", [get_weather: $get_weather], 0)() => $result
$result.turns    # Number of LLM round-trips
```

**generate(prompt, schema)** — Structured output extraction:

```rill
gemini::generate(
  "Extract metadata from: rill is a pipe-based scripting language",
  dict(
    ^("Extracted name") name: string
    ^("Confidence score") confidence: number
    tags: list
  )
) => $result
$result.data.name        # Extracted name field
$result.data.confidence  # Extracted confidence field
$result.data.tags        # Extracted tags list
$result.raw              # Original JSON string from model
$result.stop_reason      # Why generation stopped
$result.usage.input      # Input tokens (always 0; see Provider Notes)
$result.usage.output     # Output tokens (always 0; see Provider Notes)
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
gemini::message("hi") => $s
$s -> each { log }
```

**Resolve immediately** — access the full result dict at once:

```rill
gemini::message("hi")() => $result
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
| `thinking` | `text: string` | Thinking/reasoning text |
| `tool_use` | `id: string`, `name: string`, `input: dict` | Tool invocation by assistant |
| `tool_result` | `id: string`, `parts: list` | Tool result in user turn |
| `image` | `source: dict` | Image content |

Image `source` dict fields: `kind` (`"base64"` or `"url"`), `data` (string), `media_type` (string).

**Security note:** When `source.kind` is `"url"`, the extension passes the URL directly to the Gemini API. The extension does not validate or proxy the URL. Callers are responsible for ensuring the URL does not point to internal network resources (SSRF mitigation).

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

## Provider Notes

- `usage.input` and `usage.output` return 0 (Gemini API does not provide token counts consistently)
- `id` returns empty string
- SDK is `@google/genai` (preview); do NOT use `@google/generative-ai` (EOL)

## Error Behavior

The extension emits failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #AUTH`) or finely
(`guard #AUTH && raw.kind == 'authentication_failed'`).

`meta.provider == 'gemini'` on every host-fn failure.

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
| `gemini:message` | message() completes |
| `gemini:embed` | embed() completes |
| `gemini:embed_batch` | embed_batch() completes |
| `gemini:tool_loop` | tool_loop() completes |
| `gemini:generate` | generate() completes successfully |
| `gemini:tool_call` | Tool invoked during loop |
| `gemini:tool_result` | Tool returns during loop |
| `gemini:error` | Any operation fails |

### Completion Event Fields

Completion events (`gemini:message`, `gemini:tool_loop`, `gemini:generate`) include these fields:

| Field | Description |
|-------|-------------|
| `duration` | Request duration in milliseconds (`total_duration` for `tool_loop`) |
| `model` | Model identifier used for the request |
| `usage` | Token usage object (`input` and `output` counts) |
| `request` | Messages array sent to the provider API |

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
