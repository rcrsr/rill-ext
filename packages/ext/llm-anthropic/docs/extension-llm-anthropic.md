# anthropic Extension

*Anthropic API integration for rill scripts*

This extension allows rill scripts to access Anthropic's Claude API. The host declares it in `rill-config.json`, and scripts load it with `use<ext:anthropic>`. Switching to OpenAI or Google means changing the extension mount. Scripts stay identical.

Six functions cover the core LLM operations. `message` sends a single prompt. `messages` continues a multi-turn conversation. `embed` and `embed_batch` generate vector embeddings. `tool_loop` runs an agentic loop where the model calls rill closures as tools. `generate` extracts structured data as a typed dict. `message`, `messages`, and `tool_loop` return a `RillStream` value. Iterate chunks with `-> each` or resolve immediately with `()` to get the result dict. `generate` returns a dict directly (no streaming). `embed` and `embed_batch` return dicts directly.

The host sets API key, model, and temperature at creation time — scripts never handle credentials. Each call emits a structured event (`anthropic:message`, `anthropic:tool_call`) for host-side logging and metrics.

## Quick Start

```json
{
  "extensions": {
    "mounts": {
      "anthropic": "@rcrsr/rill-ext-anthropic"
    },
    "config": {
      "anthropic": {
        "api_key": "${ANTHROPIC_API_KEY}",
        "model": "claude-sonnet-4-5-20250929"
      }
    }
  }
}
```

Rill script — stream chunks:

```rill
use<ext:anthropic> => $llm
$llm.message("Explain TCP handshakes") => $s
$s -> each { log }
```

Resolve immediately to access the result dict:

```rill
anthropic::message("Explain TCP handshakes")() => $result
$result.content -> log
```

Secondary pattern (still works, not primary):

```rill
anthropic::message("Explain TCP handshakes")
```

## Configuration

```json
{
  "extensions": {
    "config": {
      "anthropic": {
        "api_key": "${ANTHROPIC_API_KEY}",
        "model": "claude-sonnet-4-5-20250929",
        "temperature": 0.7,
        "max_tokens": 4096,
        "system": "You are a helpful assistant.",
        "embed_model": "voyage-3",
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
anthropic::message("Explain TCP handshakes") => $s
$s -> each { log }

# Or resolve to result dict
anthropic::message("Explain TCP handshakes")() => $result
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
] -> anthropic::messages => $s
$s -> each { log }

# Or resolve to result dict
[
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language."],
  [role: "user", content: "Tell me more."],
] -> anthropic::messages => $s
$s() => $result
$result.content   # Latest response
$result.messages  # Full conversation history
```

**embed(text)** — Generate text embedding:

```rill
anthropic::embed("sample text") => $vec
$vec -> .dimensions  # Vector size
$vec.model           # Embedding model used
```

**embed_batch(texts)** — Batch embeddings:

```rill
["first text", "second text"] -> anthropic::embed_batch => $vectors
$vectors.len  # Number of vectors
```

**tool_loop(prompt, tools, options?)** — Agentic tool-use loop. Returns `RillStream`:

```rill
^("Get current weather for a city") |^("City name") city: string| {
  "Weather in {$city}: 72F sunny"
} => $get_weather

# Stream structured events
anthropic::tool_loop("What's the weather in Paris?", [
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
anthropic::tool_loop("What's the weather in Paris?", [
  get_weather: $get_weather,
], [max_turns: 5])() => $result
$result.content  # Final response
$result.turns    # Number of LLM round-trips
```

**generate(prompt, schema, options)** — Structured output extraction:

```rill
anthropic::generate(
  "Extract metadata from: rill is a pipe-based scripting language",
  dict(
    ^("Extracted name") name: string
    ^("Confidence score") confidence: number
    tags: list
  ),
  [system: "Extract structured data from the input."]
) => $result
$result.data.name        # Extracted name field
$result.data.confidence  # Extracted confidence field
$result.data.tags        # Extracted tags list
$result.raw              # Original JSON string from model
$result.stop_reason      # Why generation stopped
$result.usage.input      # Input tokens
$result.usage.output     # Output tokens
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
anthropic::message("hi") => $s
$s -> each { log }
```

**Resolve immediately** — access the full result dict at once:

```rill
anthropic::message("hi")() => $result
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

**Validation errors** (before API call):

- Empty prompt → `RuntimeError RILL-R004: prompt text cannot be empty`
- Missing role → `RuntimeError RILL-R004: message missing required 'role' field`
- Invalid role → `RuntimeError RILL-R004: invalid role '{value}'`
- Missing content → `RuntimeError RILL-R004: {role} message requires 'content'`
- No embed_model → `RuntimeError RILL-R004: embed_model not configured`
- Missing tools → `RuntimeError RILL-R004: tools parameter is required`

**API errors** (from provider):

- Rate limit → `RuntimeError RILL-R004: Anthropic: rate limit`
- Auth failure → `RuntimeError RILL-R004: Anthropic: authentication failed (401)`
- Timeout → `RuntimeError RILL-R004: Anthropic: request timeout`
- Other → `RuntimeError RILL-R004: Anthropic: {detail} ({status})`

**Tool loop errors**:

- Unknown tool → `RuntimeError RILL-R004: unknown tool '{name}'`
- Error limit → `RuntimeError RILL-R004: tool loop aborted after {n} consecutive errors`

**Generate errors**:

- Missing schema → `RuntimeError RILL-R004: generate requires a type expression as schema`
- Non-dict schema → `RuntimeError RILL-R004: generate requires a dict type as schema, got {kind}`
- Unsupported field type → `RuntimeError RILL-R004: unsupported type for JSON Schema: {kind}` or `unsupported type: {kind}`
- JSON parse failure → `RuntimeError RILL-R004: generate: failed to parse response JSON: {detail}`

## Events

| Event | Emitted When |
|-------|-------------|
| `anthropic:message` | message() completes |
| `anthropic:messages` | messages() completes |
| `anthropic:embed` | embed() completes |
| `anthropic:embed_batch` | embed_batch() completes |
| `anthropic:tool_loop` | tool_loop() completes |
| `anthropic:generate` | generate() completes successfully |
| `anthropic:tool_call` | Tool invoked during loop |
| `anthropic:tool_result` | Tool returns during loop |
| `anthropic:error` | Any operation fails |

### Completion Event Fields

Completion events (`anthropic:message`, `anthropic:messages`, `anthropic:tool_loop`, `anthropic:generate`) include these fields:

| Field | Description |
|-------|-------------|
| `duration` | Request duration in milliseconds (`total_duration` for `tool_loop`) |
| `model` | Model identifier used for the request |
| `usage` | Token usage object (`input` and `output` counts) |
| `request` | Messages array sent to the provider API |
| `content` | Response text from the provider |

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
