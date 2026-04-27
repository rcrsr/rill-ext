# Migration plan: rill-ext → @rcrsr/rill 0.19.0

## Context

rill 0.19.0 introduces five categories of changes that affect every extension. The first two break compile/runtime; the third changes catch behavior; the fourth and fifth are opt-in capabilities. See `/home/andre/projects/rill/CHANGELOG.md` Unreleased section.

| # | Change | Surface |
|---|--------|---------|
| 1 | `peerDependency` bump to `~0.19.0` and minor-bump every extension | 34 `package.json` |
| 2 | `ExtensionFactory` gains `(config, ctx: ExtensionFactoryCtx)` param | 27 factories |
| 3 | `AbortError` / `AutoExceptionError` collapse into `RuntimeHaltSignal` | 4 src catches + matching tests |
| 4 | `ctx.signal` available for cooperative cancellation | 14 `AbortController` sites + 17 `AbortSignal.timeout` sites |
| 5 | **`RILL-R004` removed from `ERROR_REGISTRY`**: extensions emit invalid `RillValue`s via `ctx.invalidate` using rill core's pre-registered generic atoms | 181 files reference `RILL-R004` |

**Critical finding:** item 5 is no longer optional. Every extension that throws `RuntimeError('RILL-R004', …)` raises `TypeError: Unknown error ID: RILL-R004` at runtime. This plan absorbs the fix into each extension-group phase using the generic-atom approach.

## Strategy

Phase by **extension group**, not by recommendation. Each phase touches one cohesive group of packages and applies all five changes for that group. This keeps each commit shippable, tests green at every step, and isolates blast radius.

Branch: `rill-0.19.0-migration`. One commit per phase.

Local rill resolved via `pnpm.overrides` → `link:../rill/packages/core`. Restore overrides to `{}` before final merge.

### Generic-atom approach (revised)

rill core 0.19 pre-registers a 12-atom generic taxonomy at module load (see `/home/andre/projects/rill/packages/core/src/runtime/core/types/atom-registry.ts`):

```
#ok, #R001, #TIMEOUT, #AUTH, #FORBIDDEN, #RATE_LIMIT, #QUOTA_EXCEEDED,
#NOT_FOUND, #CONFLICT, #UNAVAILABLE, #PROTOCOL, #INVALID_INPUT,
#DISPOSED, #TYPE_MISMATCH
```

Extensions emit failures via `ctx.invalidate(error, { code, provider, raw })` with `code` set to one of these generics. Provider-specific quirks (Tavily 432 plan-limit, Exa 402 credits, Brave 403 access-denied) decompose into `(generic atom, meta.provider, meta.raw.kind)`. **No extension defines `EXT_<NAME>_<CATEGORY>` atom constants.** No extension calls `ctx.registerErrorCode` for HTTP/timeout/disposed categories.

Full policy: `.claude/policies/policy-domain-ext.md` §EXT.7.

| Failure mode | Generic atom |
|---|---|
| `AbortSignal.timeout` fires; HTTP 408 | `#TIMEOUT` |
| Disposed extension; in-flight cancel | `#DISPOSED` |
| HTTP 401; missing/invalid API key | `#AUTH` |
| HTTP 403; OAuth scope; content filter | `#FORBIDDEN` |
| HTTP 404 | `#NOT_FOUND` |
| HTTP 409, 412 | `#CONFLICT` |
| HTTP 429 | `#RATE_LIMIT` |
| HTTP 402; plan limit; credits depleted | `#QUOTA_EXCEEDED` |
| HTTP 5xx; network `TypeError` | `#UNAVAILABLE` |
| `SyntaxError` on JSON parse; schema mismatch | `#PROTOCOL` |
| Empty/invalid argument; bad enum value | `#INVALID_INPUT` |
| Type assertion / conversion failure | `#TYPE_MISMATCH` |

### Per-extension migration template

For every extension touched in a phase:

1. **Version**: bump `version` to `0.19.0`; set `@rcrsr/rill` peerDep + devDep to `~0.19.0`.
2. **Factory signature**: add `_ctx: ExtensionFactoryCtx` second parameter (use `ctx` if Phase 4/5 wires it). Rename to `_ctx` if unused after refactor.
3. **Replace `RILL-R004` throws**:
   - **Inside host functions (after the wrapper boundary):** `throw ctx.invalidate(error, { code: '<GENERIC>', provider, raw: { kind, ... } })`. Pick the generic per the table above. The wrapper passes invalid values through unchanged.
   - **Factory-time validation (before any host fn runs):** `throw new RuntimeError('RILL-R001', message)`. `RILL-R001` is pre-registered in rill core.
   - **Do not** create `src/errors.ts` files with `EXT_*` constants. **Do not** call `ctx.registerErrorCode(...)` for the generic categories.
4. **Halt-error catches**: where the extension catches `AbortError` by name, add a leading `error instanceof RuntimeHaltSignal && error.atomName() === '#TIMEOUT'` branch; keep the legacy DOMException name-check below it for native fetch aborts that surface from undici. Both branches map to `#TIMEOUT`.
5. **`ctx.signal`** (where applicable): compose with per-request `AbortSignal.timeout(ms)` via `AbortSignal.any([ctx.signal, AbortSignal.timeout(ms)])`. For long-lived clients that cannot accept a signal, attach `ctx.signal.addEventListener('abort', () => dispose())`.
6. **Tests**: replace `RuntimeError` ID assertions with `getStatus(result).code.name === '<GENERIC>'`. Replace `.rejects.toThrow()` patterns with `isInvalid(result)` + `getStatus(result).message` checks since the wrapper resolves with invalid values rather than throwing. Add a stub `ctx` (`{ signal: new AbortController().signal, registerErrorCode: () => {} }`). Add one cancellation test per package that aborts `ctx.signal` and asserts the in-flight call resolves to an invalid value carrying `#TIMEOUT`.

### Verification at each phase

```bash
pnpm install
pnpm --filter <packages-touched> typecheck
pnpm --filter <packages-touched> test
pnpm --filter <packages-touched> build
pnpm --filter <packages-touched> lint
```

A phase is complete when its packages clear all five.

---

## Phase 0 — Foundation already applied

Already on `rill-0.19.0-migration` branch:

- All 34 `package.json` files version-bumped to `0.19.0`; `@rcrsr/rill` peer/devDep moved to `~0.19.0`.
- `packages/shared/ext-llm/src/tool-loop.ts`: local `RuntimeContextLike` shape extended with `metadata` and `hostContext` to match rill 0.19's `RuntimeContextLike`.
- `pnpm.overrides` in root `package.json` set to `link:../rill/packages/core`.

These changes landed in Phase 1's commit alongside the first shared-package migration.

---

## Phase 1 — Shared packages (foundation) [DONE]

**Why first:** every extension bundles these packages via `noExternal` in `tsup.config.ts`. Migrating extensions before the shared layer compiles cleanly causes cascading breaks.

**Packages (7):**
- `packages/shared/ext-param`
- `packages/shared/ext-llm`
- `packages/shared/ext-vector`
- `packages/shared/ext-kv`
- `packages/shared/ext-fs`
- `packages/shared/ext-search`
- `packages/shared/ext-prompt`

**Work specific to shared layer:**
- `ext-search/src/disposal.ts` `checkDisposed()` emits `#DISPOSED` directly (no `disposedCode` parameter).
- `ext-search/src/errors.ts` `mapSearchError`/`mapProviderSearchError` map by HTTP status to specific generics (`401→#AUTH`, `403→#FORBIDDEN`, `404→#NOT_FOUND`, `408→#TIMEOUT`, `409/412→#CONFLICT`, `429→#RATE_LIMIT`, `402→#QUOTA_EXCEEDED`, `5xx→#UNAVAILABLE`, `TypeError→#UNAVAILABLE`, `SyntaxError→#PROTOCOL`, `RuntimeHaltSignal→#TIMEOUT`). No `errorCode` parameter.
- `ext-search/src/wrapper.ts` `createSearchFunctionWrapper(provider, disposalState, inFlightState)` — 3 args, no `atoms` parameter. Composes `ctx.signal` with the per-request controller. Catches thrown invalid `RillValue`s and passes them through; otherwise calls `mapSearchError`.
- `ext-vector` and `ext-llm`: same generic-atom approach (work happens during Phases 4 and 5; shared signatures still pending).
- Tests in `packages/shared/*/src/*.test.ts`: assert `code.name === '<GENERIC>'`.

**Verification:** `pnpm --filter "./packages/shared/**" check` passes.

**Commit:** `refactor(shared)!: migrate shared packages to rill 0.19` (committed)

---

## Phase 2 — Built-in-only extensions (no SDK) [DONE]

**Why second:** simple factories, no vendor SDK quirks, exercises the per-extension template against the freshly migrated shared layer.

**Packages (6):** `crypto`, `exec`, `fetch`, `fs-local`, `kv-file`, `datetime`

**Per-extension specifics:**

| Extension | Generic atoms used | `AbortController` sites | Notes |
|-----------|---------------------|-------------------------|-------|
| `crypto` | `#INVALID_INPUT` | none | argument validation |
| `exec` | `#INVALID_INPUT`, `#TIMEOUT` | `factory.ts:61` | `ctx.signal` kills child processes on script cancel |
| `fetch` | `#TIMEOUT`, `#PROTOCOL`, `#UNAVAILABLE`, status-mapped via `atomForStatus()` helper in `request.ts` | `factory.ts`, `request.ts` | helper maps HTTP status to `#AUTH`/`#FORBIDDEN`/`#NOT_FOUND`/`#RATE_LIMIT`/`#QUOTA_EXCEEDED`/`#CONFLICT`/`#UNAVAILABLE`/`#INVALID_INPUT` |
| `fs-local` | `#INVALID_INPUT` (config), `#UNAVAILABLE` (IO), `#FORBIDDEN` (sandbox/path) | none | sandbox path violations are `#FORBIDDEN`, not `#INVALID_INPUT` |
| `kv-file` | `#INVALID_INPUT` (config), `#UNAVAILABLE` (IO, corrupt store) | none | |
| `datetime` | `#INVALID_INPUT` | none | |

No `errors.ts` files. No `ctx.registerErrorCode` calls.

**Verification:** `pnpm --filter "./packages/ext/{crypto,exec,fetch,fs-local,kv-file,datetime}" check`.

**Commit:** `refactor(ext)!: migrate built-in-only extensions to rill 0.19` (committed; superseded by follow-up commit on this branch that drops `EXT_*` constants in favor of generics)

---

## Phase 3 — Search extensions [DONE]

**Why grouped:** all five depend on `ext-search`. Phase 1 already maps generics in shared mappers; Phase 3 wires each search extension to call them and to throw `ctx.invalidate(...)` for in-fn validation.

**Packages (5):** `search-brave`, `search-exa`, `search-searxng`, `search-serper`, `search-tavily`

**Per-extension specifics:**

- Empty-query checks: `throw callCtx.invalidate(new Error(...), { code: 'INVALID_INPUT', provider, raw: { kind: 'empty_query', ... } })`.
- HTTP failures: `throw mapProviderSearchError(callCtx, PROVIDER, response.status, body)` — shared mapper picks the right atom and applies provider-specific overrides (Tavily 432/433 → `#QUOTA_EXCEEDED`, Exa 402 → `#QUOTA_EXCEEDED`, Brave 403 with error.code → `#FORBIDDEN`).
- searxng-specific: `failConfig`/`failHttp` helpers emit `#INVALID_INPUT`/`#UNAVAILABLE` for inline validation and direct fetch failures (it does not use `mapProviderSearchError`).
- `AbortSignal.timeout(ms)` sites compose with the wrapper-supplied signal (which already includes `ctx.signal`): `AbortSignal.any([signal, AbortSignal.timeout(timeout)])`.
- searxng `probeConfig` (factory-time): composes `ctx.signal` directly with `AbortSignal.timeout`; throws `RuntimeError('RILL-R001', message)` on probe failure.
- Test files: assert `getStatus(result).code.name === '<GENERIC>'` for HTTP/cancellation cases. Assert `RuntimeError.errorId === 'RILL-R001'` for factory-time config failures.

**Verification:** `pnpm --filter "./packages/ext/search-*" check`.

**Commit:** `refactor(search)!: migrate 5 search extensions to rill 0.19` (uncommitted on branch)

---

## Phase 4 — LLM extensions

**Why grouped:** all three depend on `ext-llm` and share `executeToolLoop` plumbing. `foundry` depends on `openai` SDK and joins this phase.

**Packages (4):** `llm-anthropic`, `llm-gemini`, `llm-openai`, `foundry`

**Per-extension specifics:**

- HTTP/SDK error mapping in `ext-llm/src/errors.ts` (`mapProviderError`) emits generics: `#AUTH` (401, missing key), `#FORBIDDEN` (403, content filter), `#RATE_LIMIT` (429), `#QUOTA_EXCEEDED` (402, token-budget exceeded), `#NOT_FOUND` (model not found), `#INVALID_INPUT` (context-length-exceeded, malformed prompt), `#PROTOCOL` (malformed SSE/streaming response), `#UNAVAILABLE` (5xx, network), `#TIMEOUT`.
- `mapProviderError` accepts `(ctx, provider, error)` — no atom-code parameter.
- `executeToolLoop` in `ext-llm/src/tool-loop.ts` gains `signal?: AbortSignal` in its options; each LLM factory passes `ctx.signal`. Tool loop checks `signal.aborted` between iterations and emits `#TIMEOUT` when set.
- Tool-execution failures inside the loop: emit `#PROTOCOL` for malformed tool results, `#INVALID_INPUT` for tool-arg validation, `#UNAVAILABLE` for unexpected exceptions.
- Streaming `AbortController` sites (anthropic L958, gemini L173/L260/L487/L1047, openai L117/L990, foundry L142/L991) compose with `ctx.signal`.
- `tests/tool-loop.test.ts`, `tests/functions.test.ts`, `tests/streaming.test.ts`, `foundry/tests/errors.test.ts`: assert `code.name` against the new generics; add cancellation test per package.

**Verification:** `pnpm --filter "./packages/ext/{llm-anthropic,llm-gemini,llm-openai,foundry}" check`.

**Commit:** `refactor(llm)!: migrate LLM extensions to rill 0.19 with ctx.signal cancellation`

---

## Phase 5 — Vector DB extensions [DONE]

**Packages (3):** `vectordb-chroma`, `vectordb-pinecone`, `vectordb-qdrant`

**Per-extension specifics:**

- Generic atoms: `#INVALID_INPUT` (config, dimension args), `#TYPE_MISMATCH` (vector dimension mismatch), `#NOT_FOUND` (collection/index missing), `#CONFLICT` (concurrent index modification), `#AUTH` (auth failure), `#UNAVAILABLE` (server unreachable, network), `#TIMEOUT`, `#DISPOSED`.
- `ext-vector/src/errors.ts` `mapProviderError` and `wrapVectorOperation` use generics directly (drop the parameterized `errorCode` introduced in earlier-Phase-1 drafts).
- Disposal in `wrapVectorOperation` emits `#DISPOSED`.
- Client SDKs (`chromadb`, `@pinecone-database/pinecone`, `@qdrant/js-client-rest`) do not accept a signal at construct time. Attach `ctx.signal.addEventListener('abort', () => dispose())` in each factory.
- `tests/{chroma,pinecone,qdrant}.test.ts`: update assertions.

**Verification:** `pnpm --filter "./packages/ext/vectordb-*" check`.

**Commit:** `refactor(vector)!: migrate vector DB extensions to rill 0.19`

---

## Phase 6 — Persistent-connection KV and FS

**Packages (3):** `kv-redis`, `kv-sqlite`, `fs-s3`

**Per-extension specifics:**

- Generic atoms: `#INVALID_INPUT` (config, malformed key/path), `#NOT_FOUND` (key/object missing), `#CONFLICT` (lock/etag mismatch), `#AUTH` (auth failure), `#UNAVAILABLE` (connection failure, 5xx), `#TIMEOUT`, `#DISPOSED`. `fs-s3` adds `#FORBIDDEN` for ACL denials and `#QUOTA_EXCEEDED` for bucket-quota errors.
- `kv-redis` (`ioredis`): pass `connectTimeout` derived from `ctx.signal` deadline; on `ctx.signal.abort` call `client.quit()`. Map `ioredis` errors via shared kv error mapper to generics.
- `kv-sqlite` (`better-sqlite3`): synchronous SDK; on `ctx.signal.abort` close the database handle. Wrap synchronous throws into `ctx.invalidate(... #UNAVAILABLE / #INVALID_INPUT ...)`.
- `fs-s3` (`@aws-sdk/client-s3`): the v3 SDK accepts `abortSignal` per request; thread `ctx.signal` into each `Send*Command` call via `AbortSignal.any`. Map `S3ServiceException` codes to generics.
- Tests: integration tests (Redis, MinIO) skip when service unavailable; preserve skip behavior. Unit tests update assertions.

**Verification:** `pnpm --filter "./packages/ext/{kv-redis,kv-sqlite,fs-s3}" check`.

**Commit:** `refactor(persistent)!: migrate kv-redis, kv-sqlite, fs-s3 to rill 0.19`

---

## Phase 7 — HTTP integration extensions

**Packages (2):** `outlook`, `google-workspace`

**Why grouped:** both wrap external HTTP APIs with token-refresh, retries, and AbortError handling. Highest `RuntimeError` density (google-workspace 64 throws, outlook 27).

**Per-extension specifics:**

- Rewrite `outlook/src/errors.ts` and `google-workspace/src/errors.ts`:
  - `mapGraphError(ctx, status, operation, id)` and `mapGoogleApiError(ctx, status, ...)` return invalid `RillValue`s via `ctx.invalidate` (not throws of `RuntimeError`).
  - Status mapping: `401 → #AUTH`, `403 → #FORBIDDEN` (for "insufficient permissions"), `404 → #NOT_FOUND`, `429 → #RATE_LIMIT`, `5xx → #UNAVAILABLE`. Quota responses (Google Drive `userRateLimitExceeded`, Outlook throttled headers) map to `#RATE_LIMIT` or `#QUOTA_EXCEEDED` based on the response detail.
  - `mapFetchError(ctx, error)`: `AbortError` → `#TIMEOUT`; `TypeError` → `#UNAVAILABLE`; `RuntimeHaltSignal` → `#TIMEOUT`.
- Token-refresh failures emit `#AUTH` with `meta.raw.kind === 'token_refresh_failed'`.
- `AbortSignal.timeout` sites (outlook L61, gws L68/L122) and `AbortController` sites (outlook L157, gws L153) compose with `ctx.signal`.
- Test surface is large (errors.test.ts, factory.test.ts, fetch.test.ts, auth-jwt.test.ts, auth-resolve.test.ts, send.test.ts, drive-functions.test.ts, etc.). Replace `RuntimeError`/`.rejects.toThrow` assertions with `code.name`/`isInvalid` checks; add cancellation test per extension.

**Verification:** `pnpm --filter "./packages/ext/{outlook,google-workspace}" check`.

**Commit:** `refactor(http)!: migrate outlook and google-workspace to rill 0.19`

---

## Phase 8 — Process and protocol extensions

**Packages (3):** `claude-code`, `mcp`, `prompt-md`

**Why last:** specialized lifecycles. `claude-code` spawns PTYs via `node-pty`; `mcp` opens long-lived JSON-RPC connections; `prompt-md` is pure transformation but has its own grammar surface.

**Per-extension specifics:**

- `claude-code`: emit `#INVALID_INPUT` (config), `#UNAVAILABLE` (PTY spawn failure, IO), `#PROTOCOL` (stream-parse failure), `#TIMEOUT`, `#DISPOSED`. Wire `ctx.signal` to send SIGTERM to the PTY subprocess on abort. Replace `RuntimeError` calls in `stream-parser.ts` with `ctx.invalidate({ code: 'PROTOCOL', ... })` returns.
- `mcp`: emit `#UNAVAILABLE` (transport disconnect), `#PROTOCOL` (malformed JSON-RPC), `#NOT_FOUND` (unknown tool), `#INVALID_INPUT` (bad tool args), `#TIMEOUT`, `#DISPOSED`. Wire `ctx.signal` to close the MCP client transport on abort.
- `prompt-md`: emit `#PROTOCOL` (parse failure, grammar violation), `#INVALID_INPUT` (bad frontmatter values). Pure data transformation; no `ctx.signal` work needed.

**Verification:** `pnpm --filter "./packages/ext/{claude-code,mcp,prompt-md}" check`.

**Commit:** `refactor(process)!: migrate claude-code, mcp, prompt-md to rill 0.19`

---

## Phase 9 — Final cross-cutting verification and release prep

**Tasks:**

1. `pnpm -r typecheck` clean across all 34 packages.
2. `pnpm -r build` produces `dist/` for all packages.
3. `pnpm -r test` green; integration tests skip gracefully.
4. `pnpm -r lint` clean.
5. Smoke run: `cd packages/ext/llm-anthropic && npx vitest run tests/tool-loop.test.ts` against the linked rill.
6. Confirm `CLAUDE.md` §Error Handling Convention documents the generic-atom approach (already updated in this branch). Confirm `.claude/policies/policy-domain-ext.md` §EXT.7 is current.
7. Update each extension's `docs/extension-*.md` to list the generic atoms it emits and any provider-specific `meta.raw.kind` values.
8. Restore `pnpm.overrides` in root `package.json` to `{}` once rill 0.19.0 is published to npm. Re-run `pnpm install` to confirm resolution against the published artifact.
9. Tag release: `0.19.0` for all packages.

**Commit:** `chore(release): finalize rill-ext 0.19.0`

---

## Cross-cutting decisions

### Atom usage convention

- **Reuse rill core's 12 generic atoms.** No `EXT_<EXTENSION>_<CATEGORY>` constants. No per-extension `errors.ts` files for atom name strings.
- **No `ctx.registerErrorCode` calls** for HTTP/timeout/disposed/config categories. Those atoms register at rill module load.
- **Provider-specific failure shape:** `(generic atom, meta.provider, meta.raw.kind)`. Host scripts match coarsely (`guard #UNAVAILABLE`) or finely (`guard #UNAVAILABLE && raw.kind == 'summarizer_key_missing'`).
- **Factory-time validation throws** `RuntimeError('RILL-R001', message)`. `RILL-R001` is pre-registered.
- **New generic atoms** (`#FORBIDDEN`, `#QUOTA_EXCEEDED`, `#PROTOCOL`) added to rill core in 0.19 (see `/home/andre/projects/rill/PROPOSAL-extension-error-taxonomy.md`).

### Test fixture for `ExtensionFactoryCtx`

```typescript
import type { ExtensionFactoryCtx } from '@rcrsr/rill';
export function makeFactoryCtx(): ExtensionFactoryCtx {
  return {
    signal: new AbortController().signal,
    registerErrorCode: () => {},
  };
}
```

The no-op `registerErrorCode` is safe because extensions do not register custom atoms; the generic taxonomy is process-global. Place in each package's `tests/_setup.ts` or inline at the top of the test file.

### Halt-error catch pattern

```typescript
import { RuntimeHaltSignal } from '@rcrsr/rill';

try {
  await fetch(url, { signal });
} catch (error: unknown) {
  if (error instanceof RuntimeHaltSignal && error.atomName() === '#TIMEOUT') {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider,
      raw: { kind: 'request_cancelled' },
    });
  }
  // Native fetch / undici still surfaces DOMException with name === 'AbortError'
  if (error instanceof Error && error.name === 'AbortError') {
    return ctx.invalidate(error, {
      code: 'TIMEOUT',
      provider,
      raw: { kind: 'request_timeout' },
    });
  }
  return ctx.invalidate(error, {
    code: 'UNAVAILABLE',
    provider,
    raw: { kind: 'network_error' },
  });
}
```

### Test assertion pattern

The wrapped host fn returns invalid `RillValue`s; it does not throw. Tests resolve and inspect:

```typescript
const result = await getCallable(ext, 'search').fn(args, ctx);
expect(isInvalid(result)).toBe(true);
expect(getStatus(result).code.name).toBe('UNAVAILABLE');
expect(getStatus(result).message).toContain('connection failed');
```

A small helper streamlines the common case:

```typescript
async function expectInvalidWithMessage(
  promise: Promise<unknown>,
  needle: string
): Promise<RillValue> {
  const result = (await promise) as RillValue;
  expect(isInvalid(result)).toBe(true);
  expect(getStatus(result).message).toContain(needle);
  return result;
}
```

### Out of scope

- Script/doc syntax migrations (`each/map/fold/filter` keywords, `@`-loop, `:>`): grep confirms no occurrences.
- `:code` → `:atom` rename: grep confirms no usage.
- Adding new generic atoms beyond the 12 already in rill core. Future failure modes that don't fit existing generics file a proposal against rill core, not a per-extension constant.

## Phase summary

| Phase | Group | Packages | Status | Files touched (est.) |
|-------|-------|----------|--------|----------------------|
| 0 | Foundation | 34 manifests + 1 shared src | done | 35 |
| 1 | Shared layer | 7 | done | ~25 |
| 2 | Built-in-only | 6 | done | ~40 |
| 3 | Search | 5 | done | ~25 |
| 4 | LLM | 4 | pending | ~30 |
| 5 | Vector | 3 | done | ~20 |
| 6 | Persistent KV/FS | 3 | pending | ~25 |
| 7 | HTTP integration | 2 | pending | ~50 |
| 8 | Process/protocol | 3 | pending | ~25 |
| 9 | Release prep | all | pending | docs + manifests |

Total: 9 phases, 9 commits on `rill-0.19.0-migration`, ~275 files touched. No `EXT_<NAME>_<CATEGORY>` atoms introduced; all failure modes route through rill core's 12 generic atoms plus `RILL-R001` for factory-time validation.
