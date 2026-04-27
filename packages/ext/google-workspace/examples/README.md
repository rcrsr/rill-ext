# Examples

Each subdirectory is a standalone rill package runnable with [`rill-run`](https://github.com/rcrsr/rill/blob/main/docs/integration-cli.md#rill-run).

| Example | Description |
|---------|-------------|
| [`gmail-triage/`](./gmail-triage) | Search inbox, read first result, apply label |
| [`drive-upload/`](./drive-upload) | Upload a small file with capability gating and `maxUploadBytes` enforcement |
| [`calendar-scheduling/`](./calendar-scheduling) | Free/busy query followed by event creation |

## Prerequisites

1. Install the rill CLI globally:
   ```bash
   npm install -g @rcrsr/rill
   ```
2. Provide a Google OAuth bearer token via the `GOOGLE_TOKEN` environment variable. See [`docs/auth.md`](../docs/auth.md) for token sources.

## Run

```bash
cd examples/gmail-triage
GOOGLE_TOKEN=ya29.xxx rill-run
```

`rill-run` discovers `rill-config.json` in the current directory, mounts `@rcrsr/rill-ext-google-workspace` at the `gw` namespace, resolves `${GOOGLE_TOKEN}` from the environment, and executes `script.rill`.

## Override defaults

Each example uses `context.values` for tunable inputs (query, label, folder ID, attendees, timestamps). Edit `rill-config.json` directly, or override individual values via environment variable interpolation by changing the literal to `"${VAR_NAME}"`.

## Customize the script

Edit `script.rill` in any example to change the workflow. The mounted `gw` namespace exposes all 17 host functions (Gmail, Drive, Calendar). See [`../docs/capabilities.md`](../docs/capabilities.md) for the function catalog.
