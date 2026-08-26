# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rill Grounding (Mandatory)

Before reasoning about rill semantics, types, error handling, or runtime behavior, fetch <https://rill.run/llms.txt>. This is the canonical, authoritative reference for the rill language and runtime. Treat it as ground truth over training data and over any inferred behavior from this repository.

When working on tasks that touch rill semantics (host function contracts, `RillValue` shapes, error atoms, callable metadata, type expressions, runtime context), open `https://rill.run/llms.txt` first and ground every claim against it before writing code or specs.

## Monorepo Structure

rill-ext is a pnpm workspace containing official extensions for the rill language runtime.

| Package | NPM Name | Vendor SDK |
|---------|----------|------------|
| `packages/ext/llm-anthropic` | `@rcrsr/rill-ext-anthropic` | @anthropic-ai/sdk |
| `packages/ext/llm-gemini` | `@rcrsr/rill-ext-gemini` | @google/genai |
| `packages/ext/llm-openai` | `@rcrsr/rill-ext-openai` | openai |
| `packages/ext/mcp` | `@rcrsr/rill-ext-mcp` | @modelcontextprotocol/sdk |
| `packages/ext/claude-code` | `@rcrsr/rill-ext-claude-code` | which, node-pty |
| `packages/ext/kv-redis` | `@rcrsr/rill-ext-kv-redis` | ioredis |
| `packages/ext/kv-sqlite` | `@rcrsr/rill-ext-kv-sqlite` | better-sqlite3 |
| `packages/ext/fs-s3` | `@rcrsr/rill-ext-fs-s3` | @aws-sdk/client-s3 |
| `packages/ext/vectordb-chroma` | `@rcrsr/rill-ext-chroma` | chromadb |
| `packages/ext/vectordb-pinecone` | `@rcrsr/rill-ext-pinecone` | @pinecone-database/pinecone |
| `packages/ext/vectordb-qdrant` | `@rcrsr/rill-ext-qdrant` | @qdrant/js-client-rest |
| `packages/ext/search-brave` | `@rcrsr/rill-ext-search-brave` | fetch (native) |
| `packages/ext/search-exa` | `@rcrsr/rill-ext-search-exa` | fetch (native) |
| `packages/ext/search-searxng` | `@rcrsr/rill-ext-search-searxng` | fetch (native) |
| `packages/ext/search-serper` | `@rcrsr/rill-ext-search-serper` | fetch (native) |
| `packages/ext/search-tavily` | `@rcrsr/rill-ext-search-tavily` | fetch (native) |
| `packages/ext/crypto` | `@rcrsr/rill-ext-crypto` | node:crypto (built-in) |
| `packages/ext/exec` | `@rcrsr/rill-ext-exec` | node:child_process (built-in) |
| `packages/ext/fetch` | `@rcrsr/rill-ext-fetch` | fetch (native) |
| `packages/ext/fs-local` | `@rcrsr/rill-ext-fs-local` | node:fs (built-in) |
| `packages/ext/kv-file` | `@rcrsr/rill-ext-kv-file` | node:fs (built-in) |
| `packages/ext/outlook` | `@rcrsr/rill-ext-outlook` | fetch (native) |
| `packages/ext/google-workspace` | `@rcrsr/rill-ext-google-workspace` | fetch (native), node:crypto (built-in) |
| `packages/ext/foundry` | `@rcrsr/rill-ext-foundry` | openai, @azure/identity (optional) |
| `packages/ext/prompt-md` | `@rcrsr/rill-ext-prompt-md` | yaml |
| `packages/ext/text` | `@rcrsr/rill-ext-text` | html-to-text, turndown, defuddle, linkedom, entities, linkify-it |
| `packages/shared/ext-llm` | `@rcrsr/rill-ext-llm-shared` (private) | -- |
| `packages/shared/ext-vector` | `@rcrsr/rill-ext-vector-shared` (private) | -- |
| `packages/shared/ext-kv` | `@rcrsr/rill-ext-kv-shared` (private) | -- |
| `packages/shared/ext-fs` | `@rcrsr/rill-ext-fs-shared` (private) | -- |
| `packages/shared/ext-param` | `@rcrsr/rill-ext-param-shared` (private) | -- |
| `packages/shared/ext-search` | `@rcrsr/rill-ext-search-shared` (private) | -- |
| `packages/shared/ext-prompt` | `@rcrsr/rill-ext-prompt-shared` (private) | -- |

## Commands

```bash
pnpm install             # Install dependencies
pnpm run build            # Build all packages
pnpm run test             # Run tests
pnpm run check:types      # Type validation (tsc, TypeScript 7)
pnpm run check:lint       # Check lint errors (oxlint)
pnpm run check:format     # Check formatting (oxfmt --check)
pnpm run check:deps       # Check unused dependencies/exports (knip)
pnpm run check:standards  # Repository conformance (@rcrsr/rill-dev)
pnpm run check:versions   # Every package at the root major.minor
pnpm run test:rules       # Unit tests for the custom oxlint rules
pnpm run bootstrap        # Bring a fresh clone to build-ready
pnpm run fix:lint         # Auto-fix lint errors (oxlint --fix)
pnpm run fix:format       # Auto-format files (oxfmt)
pnpm run fix:versions     # Sync package versions to the root
pnpm run check            # Complete validation (types, lint, format, deps, rules, build, test, standards)
```

Git hooks (via `lefthook`, installed automatically on `pnpm install`):

- `pre-commit`: runs `oxfmt` and `oxlint --fix` on staged files, then stages the fixes.
- `pre-push`: runs `pnpm -r run typecheck` and `pnpm -r run test`.

Package-specific:

```bash
pnpm --filter @rcrsr/rill-ext-anthropic build
pnpm --filter @rcrsr/rill-ext-anthropic test
```

Run a single test file:

```bash
cd packages/ext/llm-anthropic && npx vitest run tests/tool-loop.test.ts
```

## Repository Standards

The conformance checker and the custom oxlint rules ship in
**`@rcrsr/rill-dev`** (a devDependency). They are not copied into this
repository. The standards document is `node_modules/@rcrsr/rill-dev/REPO-STANDARDS.md`;
its only source is `rcrsr/rill` under `packages/dev/`.

**Never patch `node_modules/@rcrsr/rill-dev`.** There is no drift check to catch
it: a local edit is silently lost on the next install and leaves every other
repository with the broken behaviour. Fixes go upstream (PR against `rcrsr/rill`
→ merge → bump `packages/dev/package.json` → tag `dev-vx.y.z` → CI publishes),
then arrive here as a dependency bump. `@rcrsr/rill-dev` releases from its own
`dev-v*` tag namespace, so a lint-rule fix never mints a language version.

### CI checks the tree; a maintainer checks the host

CI runs `pnpm exec rill-check-standards` — **tree only, no `--remote`, no token.**
Do not re-add the flag. Two reasons:

- A pull request cannot change host state. Branch protection and repository
  settings are altered out of band by an admin, so gating merges on them turns
  every open PR red for a reason no author can fix.
- `GITHUB_TOKEN` cannot decide them anyway. It reads the repository object, but
  the administrative fields are omitted and `branches/*/protection` answers 404,
  so both element groups report unchecked. The flag would cost an API round trip
  and settle nothing.

Host settings are checked with `pnpm check:standards --remote` from a
maintainer's authenticated shell, where the credentials already exist and no
secret has to live in CI. That run is the only thing that sees a merge-strategy
setting disagreeing with a protection rule, which is invisible in the tree.

### Custom lint rules

Loading the plugin via `"jsPlugins": ["@rcrsr/rill-dev/lint-rules"]` only
registers the rules; they are opt-in. Both are enabled here, scoped to
`**/src/**/*.{ts,tsx}`, with the rationale for each:

- **`rill/no-spec-id-reference`: on.** This repository carries `conduct/`,
  a private planning directory, so its stated condition is met. Enabling it
  cleared 708 references across 86 files; those IDs point at documents that are
  never published, so they were unresolvable for anyone reading the code.
- **`rill/no-duplicate-error-id`: on.** The extensions construct `RuntimeError`
  in 124 places, which is what the rule keys on, so its condition is met. It
  found zero violations — it is enabled to hold that line, not to fix a backlog.

The `src/`-only scope is deliberate and outlives STD-LINT-4. Lint now covers
`src/` **and** `tests/`, but these two rules stay scoped to `src/`: what they
guard is *shipped* source. A planning identifier in a test is not published to
anyone, so widening them would add findings without closing the leak the rule
names.

### Conformance status

`pnpm check:standards` currently reports:

```
CONFORMANT  70 checked, 70 passed, 7 not machine-checkable.
```

Read the summary line, not the exit code: `--` means *not checked*, and the
element still applies. A green run means the checked subset holds; it is not a
conformance claim.

`@rcrsr/rill-dev` 0.2.2 ships a `baseline.json` snapshot of `rill`'s own config,
so the cross-repository elements that older `rill-dev` reported `--`
(`STD-LINT-1`, `STD-LINT-5`, `STD-LINT-9`, `STD-PM-2`, `STD-DEP-1..5`) are now
machine-checked here and pass. Reaching that took real changes, not just the
version bump — see **How STD-LINT-5/9 were met** below.

7 entries report `--`. None is claimed as N/A — no element here meets a stated
N/A condition. They split into:

- **Host-only**, decided by `--remote` from a maintainer shell: `STD-GATE-1..6`,
  `STD-SET-1..3`, `STD-PROC-1`. `--remote` currently finds two failures, both of
  which need an admin and neither of which a pull request can fix:
  **`STD-GATE-5`** (linear history required while merge-commit and rebase are
  both still enabled) and **`STD-SET-2`** (wiki enabled but unused).
- **Needs human judgement**: `STD-CI-2`, `STD-SCRIPT-8`, `STD-LINT-6`,
  `STD-PROC-4`.

`STD-LINT-6` (disabled rules carry counts) is `--` because the checker cannot
grade prose. It is satisfied in fact: every `off` rule in `.oxlintrc.json`
carries a comment with its measured finding count.

**How STD-LINT-5/9 were met.** The `.oxlintrc.json` `plugins` array lists all
six of `rill`'s plugins — `typescript`, `oxc`, `unicorn`, `import`, `promise`,
`vitest`. Enabling `vitest` surfaced ~1780 findings; they were cleared three
ways, all matching `rill`'s baseline rather than suppressing:

- Three expensive rules are set to `off` to match the baseline, each with a
  STD-LINT-6 count comment: `vitest/require-mock-type-parameters` (1240),
  `vitest/no-conditional-expect` (67), `vitest/require-to-throw-message` (35).
- `vitest/expect-expect` stays `error` (matching the baseline severity, so
  STD-LINT-9 holds) but carries `assertFunctionNames: ["expect", "expect*",
  "assert*"]`, teaching it that assertions reach `expect` through named helpers.
- The residual ~410 real findings (`typescript/no-explicit-any` flipped to
  `error`, `no-shadow`, `eqeqeq`, a few `import`/`promise`/`vitest` singletons,
  and the graceful-skip integration tests) were fixed in the source and tests.

One thing a green run does **not** cover, recorded so it is not mistaken for
conformance:

- **`STD-CI-7` (no path filtering) is reported `ok` but is not satisfied.** The
  checker greps for trigger-level `paths-ignore`, and `ci.yml` instead gates its
  `check` job behind a `dorny/paths-filter` job with a job-level `if:`. The
  standard forbids both forms, and names this exact shape — requiring the
  always-passing filter job as the status check in place of the real one — as
  the anti-pattern it exists to prevent. `changes` is the only required context
  on `main`, so the branch is nominally protected and actually ungated. Fixing
  it means running the full matrix on every pull request and moving the required
  contexts to the `check` legs, which is a branch-protection change an admin
  makes out of band. Tracked, not accepted.

## Core Dependency

All extension packages declare `@rcrsr/rill` as a `peerDependency`. The core runtime is consumed from npm, not from source. Types like `RillValue`, `RuntimeError`, `ExtensionResult`, `RuntimeContext`, and helpers like `isDict`, `isCallable`, `invokeCallable` come from this package.

## Versioning

Extensions use semver with two rules:

1. **Minor version compatibility**: an extension's `peerDependency` on `@rcrsr/rill` matches by minor version (e.g., `rill@0.4.x` works with any extension at `0.4.y`). A rill minor bump requires a corresponding extension minor bump.
2. **Patch version per release**: each published release increments at least the extension's patch version. Versions are decided and applied at release time, never on the feature/fix PR that introduces the change.

## Release Process

Releases are tag-driven. Each extension tracks its own version in its `package.json`; the root `package.json` carries an aggregate version that the release tag matches.

To release:

1. On a `release/vX.Y.Z` branch, set the root `package.json` to `X.Y.Z` and update the root `CHANGELOG.md` through the explicit changelog command (which stamps the `[Unreleased]` section as `[X.Y.Z] - <date>`). Do not hand-edit the changelog.
2. Open a PR, merge to `main`.
3. From `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The `release.yml` workflow triggers on the tag push, builds, tests, then publishes every non-private `packages/ext/*` whose `name@version` is not yet on npm (already-published versions are skipped). It then creates a GitHub Release with auto-generated notes.

Version numbers are release-time actions: the release tooling bumps every `version` field and stamps the `[Unreleased]` changelog section as `[X.Y.Z] - <date>`. A feature or fix PR never edits a `version` field.

Do not update any `CHANGELOG.md` unless explicitly prompted to do so. Implementation and fix PRs write source, tests, and dependency ranges only; they never touch the changelog. Authoring `[Unreleased]` entries is a separate step that runs only when explicitly prompted (via the changelog command), typically at PR time. At release time, the release tooling only stamps those accumulated entries with the version and date; it does not write them.

## Architecture

### Extension Factory Pattern

Every extension exports a `create*Extension(config)` factory function that returns an `ExtensionResult`. This result contains named host functions (as `{ fn, params }` objects) and a `dispose()` cleanup function. The factory validates config, instantiates the vendor SDK client, and defines closures over it.

Parameters use `RillParam` shape (4 fields: `name`, `type`, `defaultValue`, `annotations`). Use `p.*` helpers from `@rcrsr/rill-ext-param-shared` to construct params. Apply a `satisfies ExtensionResult` check on the return expression to catch signature drift at compile time.

Example shape:
```typescript
import { p } from '@rcrsr/rill-ext-param-shared';

export function createAnthropicExtension(config: AnthropicExtensionConfig): ExtensionResult {
  // validate config, create SDK client
  return {
    message: {
      fn: async (args, ctx) => { ... },
      params: [p.str('text'), p.dict('options')],
    },
    tool_loop: {
      fn: async (args, ctx) => { ... },
      params: [p.str('text'), p.dict('tools'), p.dict('options')],
    },
    dispose: async () => { ... },
  } satisfies ExtensionResult;
}
```

### Shared Packages

Shared packages (`packages/shared/`) are **bundled into** the consuming extension at build time via `tsup.config.ts` (`noExternal`). They are not published to npm.

- **ext-llm-shared**: Validation (`validateApiKey`, `validateModel`, `validateTemperature`), error mapping (`mapProviderError`), JSON Schema building (`buildJsonSchema`), and tool loop orchestration (`executeToolLoop`). All 3 LLM extensions depend on this.
- **ext-vector-shared**: Error mapping, event emission, batch execution, disposal state, distance normalization, and function wrappers. All 3 vector DB extensions depend on this.
- **ext-kv-shared**: Contract type (`KvExtensionContract`) for compile-time verification of KV extension function signatures. All 3 KV extensions depend on this.
- **ext-fs-shared**: Contract type (`FsExtensionContract`) for compile-time verification of FS extension function signatures. Both FS extensions depend on this.
- **ext-param-shared**: Parameter construction helpers (`p.*`) for building `RillParam` objects. All extensions that declare typed host function parameters depend on this.
- **ext-search-shared**: Validation (`assertRequired`, `validateBaseUrl`), error mapping (`mapSearchError`, `mapProviderSearchError`), event emission, function wrapper (`createSearchFunctionWrapper`), disposal and in-flight request tracking. All 5 search extensions depend on this.

### LLM Extension Call Flow

1. Factory creates vendor SDK client and returns host functions
2. `message()` / `messages()` — single/multi-turn LLM calls, provider-specific request formatting
3. `tool_loop()` — multi-turn tool calling loop:
   - Extension factory validates options and builds provider-specific callbacks (`ToolLoopCallbacks`)
   - Delegates to shared `executeToolLoop()` which handles the loop, tool dispatch via `invokeCallable()`, error tracking, and token aggregation
   - `buildJsonSchema()` converts rill callable parameter metadata to JSON Schema for the provider API
4. `embed()` / `embed_batch()` — text embedding via provider embedding API

### Search Extension Call Flow

1. Factory creates disposal state, in-flight tracking, and wrapped host functions via `createSearchFunctionWrapper`
2. Host functions build HTTP requests via native `fetch()` with `AbortSignal.timeout()`
3. Responses map to rill-compatible dicts; errors map through `mapSearchError`/`mapProviderSearchError`
4. `dispose()` calls `abortAll()` on in-flight requests, then sets disposal flag

### Tool Loop Tools Format

Tools are passed as a rill dict (JS object) mapping `name → callable`. The callable carries its own metadata (description, typed parameters). The shared `executeToolLoop()` iterates `Object.entries(toolsDict)` and calls `buildJsonSchema()` on each callable's params.

### Error Handling Convention

rill 0.19 removed `RILL-R004` from `ERROR_REGISTRY`. Extensions emit failures as invalid `RillValue`s via `ctx.invalidate(error, meta)` from inside host functions, and as `RuntimeError('RILL-R001', message)` from factory-time config validation. Full policy: `.claude/policies/policy-domain-ext.md` §EXT.7.

**Reuse rill core's generic atom taxonomy.** rill core pre-registers 12 atoms at module load: `#ok`, `#R001`, `#TIMEOUT`, `#AUTH`, `#FORBIDDEN`, `#RATE_LIMIT`, `#QUOTA_EXCEEDED`, `#NOT_FOUND`, `#CONFLICT`, `#UNAVAILABLE`, `#PROTOCOL`, `#INVALID_INPUT`, `#DISPOSED`, `#TYPE_MISMATCH`. Use these in `meta.code` directly. Do not define `EXT_<EXTENSION>_*` constants. Do not call `ctx.registerErrorCode` for categories the generic taxonomy already covers.

Provider-specific failures decompose into `(generic atom, meta.provider, meta.raw.kind)`. Example: Tavily 432 → `{ code: 'QUOTA_EXCEEDED', provider: 'tavily', raw: { kind: 'plan_limit_exceeded', status: 432 } }`. Host scripts match coarsely (`guard #QUOTA_EXCEEDED`) or finely (`guard #QUOTA_EXCEEDED && raw.kind == 'plan_limit_exceeded'`).

### Boundary Key Naming

Dict keys exposed at the rill host-function boundary MUST be snake_case. The boundary covers four surfaces:

1. Param names declared via `p.*` helpers (e.g., `p.str('message_id')`, not `p.str('messageId')`).
2. Keys read from the `args` dict inside host functions (`args['file_id']`, not `args['fileId']`).
3. Keys in returned dict object literals (`{ result_count, exit_code }`, not `{ resultCount, exitCode }`).
4. Field names in `returnType` / `retType` structure declarations passed to the runtime.

Internal TypeScript variables, vendor SDK request/response shapes, and JS-side helper types remain camelCase per JS convention. Map vendor camelCase to/from snake_case at the boundary; do not let it leak into the rill dict.

When in doubt: if a host script written in rill ever sees the key, it is snake_case.

### Build Toolchain

- **tsup**: Bundles each package to ESM (`dist/index.js`)
- **dts-bundle-generator**: Produces rolled-up type declarations (`dist/index.d.ts`)
- **vitest**: Test runner with per-package `vitest.config.ts`

### Test Patterns

- SDK clients are mocked at module level with `vi.mock()` (not real API calls)
- Tests use `createRuntimeContext()` from `@rcrsr/rill` to create test contexts
- Callable values in tests use either `callable()` helper or manual `{ __type: 'callable', kind: 'runtime', isProperty: false, fn }` objects
- Integration tests for external services (Redis, MinIO, ChromaDB) skip gracefully when the service is unavailable

## Extension Authoring

Docs for each extension live in `packages/ext/*/docs/`.
