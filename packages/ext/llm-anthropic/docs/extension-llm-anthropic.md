# anthropic Extension

*Anthropic API integration for rill scripts*

This extension allows rill scripts to access Anthropic's Claude API. The host registers it with `hoistExtension` and `extResolver`, and scripts load it with `use<ext:anthropic>`. Switching to OpenAI or Google means changing one line of host config. Scripts stay identical.

Six functions cover the core LLM operations. `message` sends a single prompt. `messages` continues a multi-turn conversation. `embed` and `embed_batch` generate vector embeddings. `tool_loop` runs an agentic loop where the model calls rill closures as tools. `generate` extracts structured data as a typed dict. `message`, `messages`, and `tool_loop` return the same dict shape (`content`, `model`, `usage`, `stop_reason`, `id`, `messages`), so scripts work across providers without changes. `generate` returns a separate shape with `data` and `raw` fields instead of `content` and `messages`.

The host sets API key, model, and temperature at creation time — scripts never handle credentials. Each call emits a structured event (`anthropic:message`, `anthropic:tool_call`) for host-side logging and metrics.

## Quick Start

```typescript
import { createRuntimeContext, extResolver, hoistExtension } from '@rcrsr/rill';
import { createAnthropicExtension } from '@rcrsr/rill-ext-anthropic';

const ext = createAnthropicExtension({
  api_key: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-5-20250929',
});
const { functions, dispose } = hoistExtension('anthropic', ext);
const ctx = createRuntimeContext({
  resolvers: { ext: extResolver },
  configurations: {
    resolvers: { ext: { anthropic: functions } },
  },
});
```

Rill script — load the extension as a handle and call functions via dot-path:

```rill
use<ext:anthropic> => $llm
$llm.message("Explain TCP handshakes") => $result
$result.content -> log
```

Direct dot-path — no intermediate variable:

```rill
use<ext:anthropic.message>("Explain TCP handshakes") => $result
$result.content -> log
```

Secondary pattern (still works, not primary):

```rill
anthropic::message("Explain TCP handshakes")
```

## Configuration

```typescript
const ext = createAnthropicExtension({
  api_key: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-5-20250929',
  temperature: 0.7,
  max_tokens: 4096,
  system: 'You are a helpful assistant.',
  embed_model: 'voyage-3',
  base_url: 'https://custom-endpoint.example.com',
  max_retries: 3,
  timeout: 30000,
});
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

**message(text, options?)** — Send a single prompt:

```rill
anthropic::message("Explain TCP handshakes") => $result
$result.content      # Response text
$result.stop_reason  # Why generation stopped
$result.usage.input  # Input tokens
$result.usage.output # Output tokens
```

**messages(messages, options?)** — Multi-turn conversation:

```rill
[
  [role: "user", content: "What is rill?"],
  [role: "assistant", content: "A scripting language."],
  [role: "user", content: "Tell me more."],
] -> anthropic::messages => $result
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

**tool_loop(prompt, options?)** — Agentic tool-use loop:

```rill
^("Get current weather for a city") |^("City name") city: string| {
  "Weather in {$city}: 72F sunny"
} => $get_weather

anthropic::tool_loop("What's the weather in Paris?", [
  tools: [get_weather: $get_weather],
  max_turns: 5,
]) => $result
$result.content  # Final response
$result.turns    # Number of LLM round-trips
```

**generate(prompt, options)** — Structured output extraction:

```rill
[
  name: "string",
  confidence: "number",
  tags: "list",
] => $schema

anthropic::generate("Extract metadata from: rill is a pipe-based scripting language", [
  schema: $schema,
  system: "Extract structured data from the input.",
]) => $result
$result.data.name        # Extracted name field
$result.data.confidence  # Extracted confidence field
$result.data.tags        # Extracted tags list
$result.raw              # Original JSON string from model
$result.stop_reason      # Why generation stopped
$result.usage.input      # Input tokens
$result.usage.output     # Output tokens
```

**generate with structured output schema:**

Define a closure with typed and annotated params, then pass its `^input` structural type as `schema`:

```text
|^("Extracted name") name: string, ^(description: "Confidence score") confidence: number, tags: list = []| { "test" } => $extractor

anthropic::generate("Extract: rill is a pipe-based scripting language", [
  schema: $extractor.^input,
  system: "Extract structured data from the input.",
]) => $result
$result.data.name        # Extracted name field
$result.data.confidence  # Extracted confidence field
$result.data.tags        # Extracted tags (optional)
```

The extension converts the structural type to a JSON Schema object via `buildJsonSchemaFromStructuralType()` before sending to the provider. Field `description` and `enum` annotations map to JSON Schema `description` and `enum` properties.

Params using `closure` or `tuple` type are not representable in JSON Schema and throw:

```text
# Error: generate schema field 'fn' uses unsupported type 'closure'
```

### Per-Call Options

| Option | Type | Applies To | Description |
|--------|------|-----------|-------------|
| `system` | string | message, messages, tool_loop, generate | Override system prompt |
| `max_tokens` | number | message, messages, tool_loop, generate | Override max tokens |
| `tools` | dict | tool_loop (required) | Tool callables keyed by name |
| `max_turns` | number | tool_loop | Limit LLM round-trips |
| `max_errors` | number | tool_loop | Consecutive error limit (default: 3) |
| `messages` | list | tool_loop, generate | Prepend conversation history |
| `schema` | dict or RillStructuralType | generate (required) | Dict descriptor (legacy) or `RillStructuralType` value (from `$closure.^input`) for structured output |

## Result Dict

All functions except `embed`, `embed_batch`, and `generate` return:

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
- Missing tools → `RuntimeError RILL-R004: tool_loop requires 'tools' option`

**API errors** (from provider):

- Rate limit → `RuntimeError RILL-R004: Anthropic: rate limit`
- Auth failure → `RuntimeError RILL-R004: Anthropic: authentication failed (401)`
- Timeout → `RuntimeError RILL-R004: Anthropic: request timeout`
- Other → `RuntimeError RILL-R004: Anthropic: {detail} ({status})`

**Tool loop errors**:

- Unknown tool → `RuntimeError RILL-R004: unknown tool '{name}'`
- Error limit → `RuntimeError RILL-R004: tool loop aborted after {n} consecutive errors`

**Generate errors**:

- Missing schema → `RuntimeError RILL-R004: generate requires 'schema' option`
- Unsupported type in schema → `RuntimeError RILL-R004: unsupported schema type '{type}'`
- Shape field with `closure` or `tuple` type → `RuntimeError RILL-R004: generate schema field '{name}' uses unsupported type '{type}'`
- JSON parse failure → `RuntimeError RILL-R004: generate response parse failed: {detail}`

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

## Test Host

A runnable example at `examples/test-host.ts` demonstrates integration:

```bash
# Set API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Built-in demo
pnpm exec tsx examples/test-host.ts

# Inline expression
pnpm exec tsx examples/test-host.ts -e 'llm::message("Tell me a joke") -> $.content -> log'

# Script file
pnpm exec tsx examples/test-host.ts script.rill
```

Override model or endpoint with `ANTHROPIC_MODEL` and `ANTHROPIC_BASE_URL`.

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
