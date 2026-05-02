# prompt-md Extension

*Markdown prompt loader for rill scripts*

This extension loads `.prompt.md` files from a directory tree and exposes each file as a typed callable. Scripts invoke prompts by resolution name, pass positional arguments in the order the params are declared in frontmatter, and receive either a rendered string or a list of role-tagged message dicts. The list form passes directly into any LLM extension's `message()` call as the first argument.

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
---
Answer the following question in {max_words} words or fewer.

Question: {question}
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | yes | Human-readable summary. Appears in `^description` annotation. |
| `params` | list[string] | yes | Parameter declarations. See grammar below. |

The frontmatter block starts and ends with `---` on its own line. The template body starts on the line after the closing `---`. The output mode is inferred from body content (see [Output Inference](#output-inference) below); no `output:` field is required or read.

### Params Grammar

Each entry in `params` follows the format:

```
name: type
name: type = default
```

Each entry MUST be a quoted YAML string. Unquoted form (`- name: type`) is parsed by YAML as a map and rejected at load time with `RuntimeError RILL-R001` (`params entries must be strings`).

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

A param without a default is required. A param with a default is optional at call time. Missing required params at invocation are rejected by the rill runtime before the closure runs (this extension does not synthesize defaults at call time).

### Output Inference

The output shape is inferred from body content at load time. There is no `output:` frontmatter field.

| Body content | Inferred output | Callable return type |
|--------------|----------------|----------------------|
| Contains at least one `@@ role` marker line | `list` | `list(dict(role: string, content: string))` |
| No `@@ role` markers | `string` | `string` |

The callable's `^output` annotation reflects the inferred mode (`"string"` or `"list"`), and `returnType` carries the corresponding rill type structure. Use `@@ role` markers when you want a multi-turn conversation list ready for `message()`. Omit them for single-turn completions.

## Resolution Names

The extension derives a resolution name from the file path relative to `basePath`.

- Strip the `.prompt.md` suffix.
- Replace each `/` path separator with `.`.
- Replace each hyphen (`-`) with an underscore (`_`).

| File path (relative to basePath) | Resolution name |
|-----------------------------------|----------------|
| `summarize.prompt.md` | `summarize` |
| `agents/research.prompt.md` | `agents.research` |
| `tasks/write/email.prompt.md` | `tasks.write.email` |
| `summarize-email.prompt.md` | `summarize_email` |
| `daily-tasks/morning-brief.prompt.md` | `daily_tasks.morning_brief` |

Resolution names become callable keys in the extension's namespace. Access them via `prompt.summarize(...)`, `prompt.agents_research(...)`, etc. The rill runtime converts `.` to `_` in callable names within a namespace.

Hyphens in filenames or directory names convert to underscores so the derived name is invocable from rill scripts. The resolution name itself can still contain `.` for nested paths (e.g. `daily_tasks.morning_brief`); the rill runtime maps `.` to `_` when resolving callable keys within a namespace. A file named `summarize-email.prompt.md` registers as `summarize_email` and is invoked as `prompt.summarize_email(...)`.

## `@@ role` Convention

> **Custom convention:** The `@@ role` marker is specific to this loader. It has no precedent in CommonMark, YAML frontmatter specifications, or any other Markdown standard. It works only in files loaded by `@rcrsr/rill-ext-prompt-md`.

Use `@@ role` lines to split a single file body into multiple conversation turns. The loader splits on lines that match exactly `^@@ <word>$` (with optional surrounding whitespace). The mere presence of one or more `@@ role` markers switches the prompt's inferred output mode to `list`.

```
---
description: Research assistant prompt.
params:
  - "question: string"
---
@@ system
You are a research assistant. Answer questions with accurate, cited information.

@@ user
{question}
```

Rules for `@@ role`:

- The marker line contains exactly `@@`, one or more spaces, a single word (the role name), and optional trailing whitespace.
- Any text before the first `@@ role` line belongs to a default section with role `user`.
- The role name MUST be one of the three valid roles: `system`, `user`, or `assistant`.
- `## headings` inside a section stay as body text. They do not create new role entries.
- A body with at least one `@@ role` marker yields `output: list`. A body with none yields `output: string` and never splits.

### Role Allowlist

Only three roles are accepted: `system`, `user`, and `assistant`. Any other role name (e.g. `tool`, `model`, `foo`) causes a `RuntimeError` when the prompt closure is invoked.

The error message includes the rejected role name and the 1-based line number of the offending marker:

```
RuntimeError RILL-R001: Invalid role marker '@@ tool' at line 5. Valid roles are: system, user, assistant.
```

This validation runs at invocation time (call time), not at load time. The extension loads the file successfully if the `@@ role` syntax is present. The role-name check fires when a script calls the prompt closure.

For example, a file containing `@@ tool` at line 5 loads without error. The first script call to that closure throws:

```
RuntimeError RILL-R001: Invalid role marker '@@ tool' at line 5. Valid roles are: system, user, assistant.
```

A body with no `@@ role` markers at all throws at invocation time:

```
RuntimeError RILL-R001: prompt body must contain at least one role marker (@@ role)
```

### Role Output Shape

The callable returns a rill list of dicts. Each dict has two string keys.

```
[
  { role: "system", content: "You are a research assistant..." },
  { role: "user",   content: "What caused the 2008 financial crisis?" }
]
```

This shape is `list(dict(role: string, content: string))`. It passes directly into `message()` on any LLM extension as the first argument. All three LLM extensions — `@rcrsr/rill-ext-anthropic`, `@rcrsr/rill-ext-openai`, and `@rcrsr/rill-ext-gemini` — accept a list of `{ role, content }` dicts as the first argument to `message()`. See [LLM extension `message()` list input](#consuming-the-message-list-in-llm-extensions) below.

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
| `^output` | string | `"string"` or `"list"`, inferred from the body's `@@ role` markers |

The callable's `returnType` is set concretely: `string` for `^output: "string"` prompts and `list(dict(role: string, content: string))` for `^output: "list"` prompts. It is never `any`.

Use `^hash` to detect when a prompt file changes between runs. Use `^input` to introspect parameter names and types at runtime.

## Consuming the Message List in LLM Extensions

The `list(dict(role: string, content: string))` output produced by a `@@ role` prompt flows directly into `message()` on any LLM extension. Pass the list as the first argument to `message()`. All three LLM extensions — `@rcrsr/rill-ext-anthropic`, `@rcrsr/rill-ext-openai`, and `@rcrsr/rill-ext-gemini` — accept either a plain string or a `list(dict(role: string, content: string))` as the first argument to `message()`. Swap the `llm` mount to a different provider and the script works unchanged.

```rill
$prompt.research("What caused the 2008 financial crisis?") => $messages
# $messages is list(dict(role: string, content: string))
# Pass it directly to message() — no reformatting needed.
$llm.message($messages, [max_tokens: 1024]) => $result
```

See [llm-anthropic](../llm-anthropic/docs/extension-llm-anthropic.md), [llm-openai](../llm-openai/docs/extension-llm-openai.md), and [llm-gemini](../llm-gemini/docs/extension-llm-gemini.md) for `message()` signature details.

## Runnable Example

This example loads a research prompt whose body uses `@@ role` markers, so the inferred output is a message list ready for any LLM extension's `message()` call.

### Prompt file: `agents/research.prompt.md`

```markdown
---
description: Answers a research question with a cited response.
params:
  - "question: string"
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
# The closure returns list(dict(role: string, content: string)) because the
# body contains @@ role markers (inferred output is "list").
$prompt.agents_research("What caused the 2008 financial crisis?") => $messages

# Pass the message list directly into message().
# message() accepts string or list(dict(role: string, content: string)).
# No per-provider formatting needed -- the shape is identical for all LLM extensions.
$llm.message($messages, [max_tokens: 1024]) => $result

$result.content -> log
```

The `$messages` value is a list of `{ role, content }` dicts. `message()` on `@rcrsr/rill-ext-anthropic`, `@rcrsr/rill-ext-openai`, and `@rcrsr/rill-ext-gemini` all accept this shape without modification. Swap the `llm` mount to a different provider and the script works unchanged.

## Error Behavior

The extension surfaces failures in three places: factory-time validation throws
`RuntimeError RILL-R001` before any host fn runs; parse-time role validation
throws `RuntimeError RILL-R001` at closure invocation time; other closure-runtime
failures emit invalid `RillValue`s carrying rill core's generic atoms. Host scripts
match coarsely (`guard #PROTOCOL`) or finely
(`guard #PROTOCOL && raw.kind == 'closure_failure'`).

**Factory-time validation** (during `createPromptMdExtension`, before any closure runs):

| Condition | Code |
|---|---|
| `basePath` empty / not a string (EC-6) | `RILL-R001` |
| `basePath` does not exist or is not a directory (EC-7) | `RILL-R001` |
| Frontmatter fence missing or malformed (EC-8) | `RILL-R001` |
| Frontmatter is not a YAML mapping or fails YAML parse (EC-9) | `RILL-R001` |
| Missing / invalid `description` or `params` (EC-10) | `RILL-R001` |
| Param entry not a string, or grammar parse failure (EC-12) | `RILL-R001` |
| Template `{name}` references a param not declared in `params` (EC-13) | `RILL-R001` |
| Multiple files resolve to the same prompt name (EC-15) | `RILL-R001` |

**Call-time validation** (during closure invocation, `RuntimeError` thrown synchronously):

| Condition | Code | Error message |
|---|---|---|
| Body has no `@@ role` markers (EC-5) | `RILL-R001` | `prompt body must contain at least one role marker (@@ role)` |
| Role marker uses a name not in `{system, user, assistant}` (EC-23) | `RILL-R001` | `Invalid role marker '@@ {role}' at line {N}. Valid roles are: system, user, assistant.` |

The `{role}` and `{N}` placeholders in EC-23 are filled with the actual rejected role name and 1-based line number. Example: `Invalid role marker '@@ tool' at line 5. Valid roles are: system, user, assistant.`

**Host-fn errors** (during closure invocation, invalid `RillValue` emitted):

| Failure | Atom | `meta.raw.kind` |
|---|---|---|
| Extension disposed before invocation | `#DISPOSED` | `disposed` |
| Uncaught internal failure during interpolation / role split (EC-17) | `#PROTOCOL` | `closure_failure` |

## See Also

- [rill](https://github.com/rcrsr/rill) -- Core language runtime
- [Extensions Guide](https://github.com/rcrsr/rill/blob/main/docs/integration-extensions.md) -- Extension contract and patterns
- [llm-anthropic](../llm-anthropic/docs/extension-llm-anthropic.md) -- Anthropic Claude extension
- [llm-openai](../llm-openai/docs/extension-llm-openai.md) -- OpenAI extension
- [llm-gemini](../llm-gemini/docs/extension-llm-gemini.md) -- Google Gemini extension
