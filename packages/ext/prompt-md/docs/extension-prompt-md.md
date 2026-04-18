# prompt-md Extension

*Markdown prompt loader for rill scripts*

This extension loads `.prompt.md` files from a directory tree and exposes each file as a typed callable. Scripts invoke prompts by resolution name, pass positional arguments in the order the params are declared in frontmatter, and receive either a rendered string or a list of role-tagged message dicts. The list form passes directly into any LLM extension's `messages()` call.

## Overview

You write prompts as Markdown files with YAML frontmatter. The extension scans `basePath` at startup, parses each `.prompt.md` file, and registers one callable per file. The callable accepts the params declared in frontmatter and returns either a rendered string or a list of `{ role, content }` dicts.

The extension registers callables under a flat namespace. Pass the namespace to `prefixFunctions` like any other extension.

## File Format

Every prompt file has two parts: a YAML frontmatter block and a template body.

```
---
description: One-sentence summary of what this prompt does.
params:
  - "question: string"
  - "max_words: number = 200"
output: string
---
Answer the following question in {max_words} words or fewer.

Question: {question}
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | yes | Human-readable summary. Appears in `^description` annotation. |
| `params` | list[string] | yes | Parameter declarations. See grammar below. |
| `output` | string | yes | `string` or `list`. The value `dict` is reserved and rejected in v0. |

The frontmatter block starts and ends with `---` on its own line. The template body starts on the line after the closing `---`.

### Params Grammar

Each entry in `params` follows the format:

```
name: type
name: type = default
```

Each entry MUST be a quoted YAML string. Unquoted form (`- name: type`) is parsed by YAML as a map and rejected at load time with `RILL-R004` (`params entries must be strings`).

**Type expression** is any static rill type accepted by rill's type-ref grammar. The grammar supports all of rill's built-in type names and parameterized forms.

**Supported scalar names:** `string`, `number`, `bool`, `dict`, `list`, `any`, `tuple`, `ordered`, `datetime`, `duration`.

Note: `num` and `callable` are NOT accepted. Use `number` — `num` is not a valid rill type name. `callable` is not a valid rill type name.

**Parameterized forms:**

| Form | Meaning |
|------|---------|
| `list(T)` | Homogeneous list of type T |
| `dict(T)` | Dict with all values of type T |
| `dict(a: T1, b: T2)` | Dict with named, typed fields |
| `list(dict(a: string, b: string))` | Nested composition |
| `list(list(string))` | Nested lists |

**Rejected in v0:**

- Dynamic refs (`$T`) — frontmatter has no runtime type scope.
- Union types (`string | number`) — not supported in v0.
- The following type names are rejected because they have no useful text rendering in a prompt: `closure`, `iterator`, `stream`, `vector`, `type`. These render via `formatValue` as placeholder strings (e.g. `type(closure)`, `vector(model, Nd)`) that produce garbage in rendered prompt text.

**Defaults** are supported only on scalar types (`string`, `number`, `bool`) in v0. Dict, list, and any params cannot have defaults.

Examples:

```yaml
params:
  - "question: string"
  - "temperature: number = 0.7"
  - "tags: list"
  - "context: dict"
  - "articles: list(dict(title: string, body: string))"
```

A param without a default is required. A param with a default is optional at call time. The extension raises `RILL-R004` when a required param is missing at invocation.

### Output Values

| Value | Callable returns |
|-------|-----------------|
| `string` | Interpolated body as a single string |
| `list` | List of `{ role, content }` dicts, one per `@@ role` section |
| `dict` | Reserved. Rejected at load time with `RILL-R004`. |

Use `output: string` for single-turn completions. Use `output: list` for multi-turn or structured conversation prompts.

## Resolution Names

The extension derives a resolution name from the file path relative to `basePath`.

- Strip the `.prompt.md` suffix.
- Replace each `/` path separator with `.`.

| File path (relative to basePath) | Resolution name |
|-----------------------------------|----------------|
| `summarize.prompt.md` | `summarize` |
| `agents/research.prompt.md` | `agents.research` |
| `tasks/write/email.prompt.md` | `tasks.write.email` |

Resolution names become callable keys in the extension's namespace. Access them via `prompt.summarize(...)`, `prompt.agents_research(...)`, etc. The rill runtime converts `.` to `_` in callable names within a namespace.

## `@@ role` Convention

> **Custom convention:** The `@@ role` marker is specific to this loader. It has no precedent in CommonMark, YAML frontmatter specifications, or any other Markdown standard. It works only in files loaded by `@rcrsr/rill-ext-prompt-md` with `output: list`.

Use `@@ role` lines to split a single file body into multiple conversation turns. The loader splits on lines that match exactly `^@@ <word>$` (with optional surrounding whitespace).

```
---
description: Research assistant prompt.
params:
  - "question: string"
output: list
---
@@ system
You are a research assistant. Answer questions with accurate, cited information.

@@ user
{question}
```

Rules for `@@ role`:

- The marker line contains exactly `@@`, one or more spaces, a single word (the role name), and optional trailing whitespace.
- Any text before the first `@@ role` line belongs to a default section with role `user`.
- The role name is arbitrary. Common values: `system`, `user`, `assistant`.
- `## headings` inside a section stay as body text. They do not create new role entries.
- `@@ role` applies only when `output: list`. In `output: string` files the marker lines appear verbatim in the output.

### Role Output Shape

The callable returns a rill list of dicts. Each dict has two string keys.

```
[
  { role: "system", content: "You are a research assistant..." },
  { role: "user",   content: "What caused the 2008 financial crisis?" }
]
```

This shape passes directly into `messages()` on any LLM extension without per-provider transformation (see Runnable Example below).

## Interpolation Rules

The body uses single-brace substitution for named params. The rules below cover all cases.

| Syntax | Result |
|--------|--------|
| `{name}` | Value of param `name` |
| `{{` | Literal `{` |
| `}}` | Literal `}` |
| `{{name}}` | Literal `{name}` (no substitution) |

### Type Coercion

All values render via `formatValue` from `@rcrsr/rill`, which is rill's canonical stringifier. Dicts and lists produce rill literal syntax, not JSON. If you want JSON, stringify in the rill script before passing the value in.

| Param type | Interpolation rendering |
|------------|------------------------|
| string | Used as-is |
| number, bool | `formatValue()` canonical string |
| null / undefined | Empty string |
| dict, list, other | `formatValue()` canonical rill literal |

## Closure Annotations

Every callable loaded by this extension carries annotations on its closure object. Access them via the rill `^` annotation syntax.

| Annotation | Type | Value |
|------------|------|-------|
| `^id` | string | Resolution name (e.g., `agents.research`) |
| `^hash` | string | Hex SHA-256 of `(canonical params grammar) + "\n" + output + "\n" + body` |
| `^description` | string | `description` field from frontmatter, verbatim |
| `^input` | list[dict] | Ordered `[{ name, type }]` from the parsed params list |
| `^output` | string | `"string"` or `"list"` |

Use `^hash` to detect when a prompt file changes between runs. Use `^input` to introspect parameter names and types at runtime.

## Runnable Example

This example loads a research prompt with `output: list` and passes the result directly into `llm-anthropic`'s `messages()` function.

### Prompt file: `agents/research.prompt.md`

```markdown
---
description: Answers a research question with a cited response.
params:
  - "question: string"
output: list
---
@@ system
You are a research assistant. Provide accurate, well-cited answers.

@@ user
{question}
```

### rill-config.json

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "llm": "@rcrsr/rill-ext-anthropic",
      "prompt": "@rcrsr/rill-ext-prompt-md"
    },
    "config": {
      "llm": {
        "api_key": "${ANTHROPIC_API_KEY}",
        "model": "claude-sonnet-4-5-20250929"
      },
      "prompt": {
        "basePath": "./prompts"
      }
    }
  }
}
```

### TypeScript host setup

```typescript
import { createRuntimeContext, prefixFunctions } from '@rcrsr/rill';
import { createAnthropicExtension } from '@rcrsr/rill-ext-anthropic';
import { createPromptMdExtension } from '@rcrsr/rill-ext-prompt-md';

const anthropicExt = createAnthropicExtension({
  api_key: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-5-20250929',
});

const promptExt = createPromptMdExtension({
  basePath: './prompts',
});

const ctx = createRuntimeContext({
  functions: {
    ...prefixFunctions('llm', anthropicExt),
    ...prefixFunctions('prompt', promptExt),
  },
});

// execute script ...

await anthropicExt.dispose();
await promptExt.dispose();
```

### app.rill

```rill
use<ext:llm>    => $llm
use<ext:prompt> => $prompt

# Invoke the prompt closure with the question param.
# Args are positional and bind to params in declaration order.
# The closure returns list[{ role, content }] because output is "list".
$prompt.agents_research("What caused the 2008 financial crisis?") => $messages

# Pass the message list directly into messages().
# No per-provider formatting needed -- the shape is identical for all LLM extensions.
$llm.messages($messages, [max_tokens: 1024]) => $result

$result.content -> log
```

The `$messages` value is a list of `{ role, content }` dicts. `messages()` on `@rcrsr/rill-ext-anthropic`, `@rcrsr/rill-ext-openai`, and `@rcrsr/rill-ext-gemini` all accept this shape without modification. Swap the `llm` mount to a different provider and the script works unchanged.

## Errors

| Condition | Code | Description |
|-----------|------|-------------|
| `output: dict` in frontmatter | RILL-R004 | `dict` output is reserved in v0 |
| Missing required param at invocation | RILL-R004 | Param has no default and was not passed |
| File fails YAML parse | RILL-R004 | Frontmatter is not valid YAML |
| Missing `description` or `params` or `output` | RILL-R004 | Required frontmatter field absent |
| File not found at `basePath` | RILL-R004 | `basePath` does not exist or is not a directory |

## See Also

- [rill](https://github.com/rcrsr/rill) -- Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) -- Extension contract and patterns
- [llm-anthropic](../llm-anthropic/docs/extension-llm-anthropic.md) -- Anthropic Claude extension
- [llm-openai](../llm-openai/docs/extension-llm-openai.md) -- OpenAI extension
- [llm-gemini](../llm-gemini/docs/extension-llm-gemini.md) -- Google Gemini extension
