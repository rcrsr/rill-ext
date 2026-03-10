# openai Extension

*OpenAI API integration for rill scripts*

This extension allows rill scripts to access OpenAI's GPT and embedding APIs. The host registers it with `hoistExtension` and `extResolver`, and scripts load it with `use<ext:openai>`. Switching to Anthropic or Google means changing one line of host config. Scripts stay identical.

Six functions cover the core LLM operations. `message` sends a single prompt. `messages` continues a multi-turn conversation. `embed` and `embed_batch` generate vector embeddings — OpenAI offers `text-embedding-3-small` and `text-embedding-3-large` for this. `tool_loop` runs an agentic loop where the model calls rill closures as tools. `generate` extracts structured output matching a schema dict. `message`, `messages`, and `tool_loop` return a `content`/`messages` shape. `generate` returns a `data`/`raw` shape.

The host sets API key, model, and temperature at creation time — scripts never handle credentials. Each call emits a structured event (`openai:message`, `openai:tool_call`) for host-side logging and metrics.

## Quick Start

```typescript
import { createRuntimeContext, extResolver, hoistExtension } from '@rcrsr/rill';
import { createOpenAIExtension } from '@rcrsr/rill-ext-openai';

const ext = createOpenAIExtension({
  api_key: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o',
});
const { functions, dispose } = hoistExtension('openai', ext);
const ctx = createRuntimeContext({
  resolvers: { ext: extResolver },
  configurations: {
    resolvers: { ext: { openai: functions } },
  },
});
```

Rill script — load the extension as a handle and call functions via dot-path:

```rill
use<ext:openai> => $llm
$llm.message("Explain TCP handshakes") => $result
$result.content -> log
```

Direct dot-path — no intermediate variable:

```rill
use<ext:openai.message>("Explain TCP handshakes") => $result
$result.content -> log
```

Secondary pattern (still works, not primary):

```rill
openai::message("Explain TCP handshakes")
```

## Configuration

```typescript
const ext = createOpenAIExtension({
  api_key: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o',
  temperature: 0.7,
  max_tokens: 4096,
  system: 'You are a helpful assistant.',
  embed_model: 'text-embedding-3-small',
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
openai::message("Explain TCP handshakes") => $result
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
] -> openai::messages => $result
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

**tool_loop(prompt, options?)** — Agentic tool-use loop:

```rill
^("Get current weather for a city") |^("City name") city: string| {
  "Weather in {$city}: 72F sunny"
} => $get_weather

openai::tool_loop("What's the weather in Paris?", [
  tools: [get_weather: $get_weather],
  max_turns: 5,
]) => $result
$result.content  # Final response
$result.turns    # Number of LLM round-trips
```

**generate(prompt, options)** — Structured output extraction:

```rill
[name: "string", age: "number", active: "bool"] => $schema

openai::generate("Extract user info: Alice, 30, active", [
  schema: $schema,
]) => $result
$result.data            # Parsed dict matching schema keys
$result.raw             # Original JSON string from model
$result.usage.input     # Input tokens
$result.usage.output    # Output tokens
```

**generate with structured output schema:**

Define a closure with typed and annotated params, then pass its `^input` structural type as `schema`:

```rill
|^("Full name") name: string, ^(description: "Age in years") age: number, active: bool = false| { "test" } => $extractor

openai::generate("Extract user info: Alice, 30, active", [
  schema: $extractor.^input,
  system: "Extract structured data from the input.",
]) => $result
$result.data.name    # Extracted name field
$result.data.age     # Extracted age field
$result.data.active  # Extracted active field (optional)
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

- Rate limit → `RuntimeError RILL-R004: OpenAI: rate limit`
- Auth failure → `RuntimeError RILL-R004: OpenAI: authentication failed (401)`
- Timeout → `RuntimeError RILL-R004: OpenAI: request timeout`
- Other → `RuntimeError RILL-R004: OpenAI: {detail} ({status})`

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

## Test Host

A runnable example at `examples/test-host.ts` demonstrates integration:

```bash
# Set API key
export OPENAI_API_KEY="sk-..."

# Built-in demo
pnpm exec tsx examples/test-host.ts

# Inline expression
pnpm exec tsx examples/test-host.ts -e 'llm::message("Tell me a joke") -> $.content -> log'

# Script file
pnpm exec tsx examples/test-host.ts script.rill
```

Override model or endpoint with `OPENAI_MODEL` and `OPENAI_BASE_URL`. Works with any OpenAI-compatible server:

```bash
# LM Studio
OPENAI_BASE_URL=http://localhost:1234/v1 OPENAI_API_KEY=lm-studio OPENAI_MODEL=local pnpm exec tsx examples/test-host.ts

# Ollama
OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama OPENAI_MODEL=llama3.2 pnpm exec tsx examples/test-host.ts
```

## See Also

- [rill](https://github.com/rcrsr/rill) — Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) — Extension contract and patterns
- [Host API Reference](https://github.com/rcrsr/rill/blob/main/docs/ref-host-api.md) — Runtime context and host functions
