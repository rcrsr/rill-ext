# @rcrsr/rill-ext-prompt-md

[rill](https://rill.run) extension that loads `.prompt.md` files from a directory tree and exposes each file as a typed callable. Prompts carry typed params, interpolation placeholders, and optional `@@ role` sections that produce a message list ready for any LLM extension's `messages()` call.

## Install

```bash
npm install @rcrsr/rill-ext-prompt-md
```

## Quick Start

**prompts/summarize.prompt.md**

```markdown
---
description: Summarize a passage in a bounded word count.
params:
  - passage: string
  - max_words: number = 200
output: string
---
Summarize the following passage in {max_words} words or fewer.

{passage}
```

**rill-config.json**

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "prompt": "@rcrsr/rill-ext-prompt-md"
    },
    "config": {
      "prompt": {
        "basePath": "./prompts"
      }
    }
  }
}
```

**app.rill**

```rill
use<ext:prompt> => $prompt

$prompt.summarize("Long passage here...") -> log
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/extension-prompt-md.md) for file format, frontmatter grammar, `@@ role` convention, interpolation rules, closure annotations, and a runnable LLM round-trip example.

## License

MIT
