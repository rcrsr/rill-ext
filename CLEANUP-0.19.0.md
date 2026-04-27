# Cleanup plan: complete the rill 0.19 in-fn error migration

## Context

`MIGRATION-0.19.0.md` Phases 1–8 are committed on `rill-0.19.0-migration`. A Phase 9 readiness audit (2026-04-27) revealed that Phases 4 (LLM) and 8 (prompt-md) shipped with incomplete in-function error migrations. The committed code substituted some `RILL-R004` throws but left the larger `RILL-R005` / `RILL-R001` in-function throw paths intact.

Per `policy-domain-ext.md` §EXT.7 and `MIGRATION-0.19.0.md` §Per-extension migration template:

- **Factory-time validation** (before any host fn runs): `throw new RuntimeError('RILL-R001', message)` is correct.
- **Inside host functions** (after the wrapper boundary): failures must be `throw ctx.invalidate(error, { code: '<GENERIC>', provider, raw: { kind, ... } })`. `RuntimeError` thrown from this path violates policy.

Tests still pass because rill core 0.19 keeps `RILL-R001` and `RILL-R005` in `ERROR_REGISTRY`, so the throws don't crash. They are silent policy violations that subvert the host-script `guard #ATOM` model: scripts cannot match an in-flight `RuntimeError` the same way they match an invalid `RillValue` carrying a generic atom.

## Audit summary (2026-04-27)

`grep -rn "throw new RuntimeError" packages/ext/*/src/`, classified by call site:

| Package | FACTORY (legit `RILL-R001`) | IN-FN (violation) | HELPER (called from in-fn) | Status |
|---|---|---|---|---|
| llm-anthropic | 0 | 19 | 0 | needs migration |
| llm-gemini | 0 | 13 | 0 | needs migration |
| llm-openai | 0 | 18 | 0 | needs migration |
| foundry | 3 | 30 | 4 | partially migrated |
| prompt-md | 4 | 0 | 13 | parser helpers need migration |
| outlook | 6 | 0 | 0 | clean |
| google-workspace | 13 | 0 | 0 | clean |
| kv-redis | 5 | 0 | 0 | clean |
| kv-sqlite | 4 | 0 | 0 | clean |
| fs-s3 | 4 | 0 | 0 | clean |
| claude-code | 1 | 0 | 0 | clean |
| **Total** | **40** | **80** | **17** | **97 violations** |

Verification commands at the time of audit:

- `pnpm -r typecheck`: clean (33 packages report Done).
- `pnpm -r build`: clean.
- `pnpm -r test`: foundry exits 1 due to a missing assertion in `tests/generate.test.ts:302` that lets a `RuntimeError('RILL-R005')` rejection escape; 176/176 assertions still pass. All other packages green.
- `pnpm -r lint`: not yet run.

## Helper-threading decision

Foundry helpers (`grounding.ts`, `safety.ts`, `search.ts`, `client.ts`, `errors.ts`) and prompt-md `parseFile.ts` currently throw `RuntimeError` from module-level functions called from host `fn:` closures. Two options:

- **(a) Thread `ctx`**: pass `RuntimeContext` (or a narrowed `InvalidatingCtx` shape) into each helper signature; helpers call `throw ctx.invalidate(err, { code, provider, raw })` directly.
- **(b) Sentinel + re-emit**: helpers throw a typed sentinel class (e.g. `FoundryHelperError`); host fn catches, reconstructs `meta`, calls `ctx.invalidate`.

**Choose (a).** Helpers already own provider, status, and `raw.kind` context; the sentinel approach forces them to encode that as instance fields and the caller to decode them, doubling the surface and losing type checking on the meta shape. Threading `ctx` is one extra parameter per helper. Every existing call site already has `ctx` in scope.

Convention: helpers take `ctx: RuntimeContext` as their first parameter (or last, matching existing arg order — pick one and apply uniformly per package). Helpers that previously returned `T` and threw on failure now return `T` and throw an invalid `RillValue` via `ctx.invalidate`. The caller's wrapper boundary handles invalid passthrough unchanged.

## Phase A — LLM extension in-fn migration

**Packages (3):** `llm-anthropic`, `llm-gemini`, `llm-openai`. Total in-fn throws: 50.

Scope:
1. In each `src/factory.ts`, replace every `throw new RuntimeError('RILL-R005', ...)` and `throw new RuntimeError('RILL-R001', ...)` inside `fn:` closures with `throw ctx.invalidate(error, { code: '<GENERIC>', provider, raw: { kind, ... } })`. Generic atom selection per `MIGRATION-0.19.0.md` §Phase 4.
2. Update `packages/shared/ext-llm/src/errors.ts` `mapProviderError(ctx, provider, error)` if any LLM extension passes through an unmapped path. The shared mapper is the right home for HTTP-status-to-generic translation; per-extension code calls it.
3. Tests (`tests/tool-loop.test.ts`, `tests/streaming.test.ts`, `tests/functions.test.ts`, `tests/errors.test.ts`): replace `.rejects.toThrow()` patterns with `isInvalid(result)` + `getStatus(result).code.name === '<GENERIC>'`. Add `ctx` stub including `signal`, `registerErrorCode`, and `invalidate`.

Verification: `pnpm --filter "./packages/ext/{llm-anthropic,llm-gemini,llm-openai}" check`.

Commit: `refactor(llm)!: replace in-fn RuntimeError with ctx.invalidate generics`.

## Phase B — Foundry full migration

**Package (1):** `foundry`. In-fn throws: 30 (in `factory.ts`); helper throws: 4 (`grounding.ts`, `safety.ts`, `search.ts`, `client.ts`, `errors.ts`).

Scope:
1. Preserve the 3 factory-time `RILL-R001` throws (`endpoint`/`auth` validation). Migrate the other 30 in-fn throws to `ctx.invalidate`.
2. Thread `ctx: RuntimeContext` through helpers in `grounding.ts`, `safety.ts`, `search.ts`, `client.ts`. Update `errors.ts` mapper signatures from `mapXError(...) → RuntimeError` to `mapXError(ctx, ...) → never` (always throws `ctx.invalidate(...)`). Update all call sites to pass `ctx` from the enclosing host fn.
3. Generic atom selection per `MIGRATION-0.19.0.md` §Phase 4: `#AUTH` (401, missing key, token acquisition), `#FORBIDDEN` (403, content filter), `#RATE_LIMIT` (429), `#QUOTA_EXCEEDED` (402, token-budget), `#NOT_FOUND` (model not deployed), `#INVALID_INPUT` (empty prompt, malformed messages, unresolved variables), `#PROTOCOL` (malformed JSON, malformed SSE), `#UNAVAILABLE` (5xx, network), `#TIMEOUT`, `#DISPOSED`.
4. Fix `tests/generate.test.ts:302` — the `await expect(...)` with no matcher. Convert to `isInvalid` + `code.name === 'PROTOCOL'` + `raw.kind === 'json_parse_failed'`.
5. Update remaining tests across `tests/{generate,errors,grounding,safety,search,client,factory}.test.ts` to assert `code.name` and `isInvalid`.

Verification: `pnpm --filter @rcrsr/rill-ext-foundry check`.

Commit: `refactor(foundry)!: migrate in-fn and helper RuntimeError to ctx.invalidate generics`.

## Phase C — prompt-md parser migration

**Reclassification (2026-04-27):** the audit miscategorized `parseFile.ts` throws as "helper called from in-fn". Investigation showed `parseFile()` is invoked only from `factory.ts:82` via eager `Promise.all` during factory init; no host-fn closure ever calls it. All 13 `throw new RuntimeError('RILL-R001', ...)` sites in `parseFile.ts` are factory-time validation and correct per `policy-domain-ext.md` §EXT.7. The two real in-fn paths (`buildClosure.ts` EC-17 and `factory.ts` disposal guard) already use `ctx.invalidate` from earlier phases.

**Package (1):** `prompt-md`. In-fn throws: 0 (no migration). Factory throws: 17 (4 in `factory.ts` + 13 in `parseFile.ts`, all legit `RILL-R001`).

Scope (docs/comments hygiene only):
1. Replace stale `RILL-R004` references in source comments (`factory.ts:80`, `buildClosure.ts:40`, `parseFile.ts:119`).
2. Rewrite the `## Errors` section in `docs/extension-prompt-md.md` to enumerate factory-time `RILL-R001` failures and the two in-fn generic atoms (`#DISPOSED`, `#PROTOCOL`), mirroring the `Failure / Atom / meta.raw.kind` table in `packages/ext/vectordb-chroma/docs/extension-vectordb-chroma.md:166–195`.
3. Update the `EC-17` describe block in `tests/functions.test.ts:553` to reference `#PROTOCOL` + `ctx.invalidate` instead of `RILL-R004`. The block is documentation-only (`it.skip`); no behavioral change.

Verification: `pnpm --filter @rcrsr/rill-ext-prompt-md check`; `grep -rn 'RILL-R004\|RILL-R005' packages/ext/prompt-md/{src,tests,docs}` returns 0.

Commit: `docs(prompt-md): retire stale RILL-R004 references; reclassify parseFile audit`.

## Phase D — Docs, verification, and release (original Phase 9)

**Scope:** the work described in `MIGRATION-0.19.0.md` §Phase 9.

1. Run cross-cutting verification:
   - `pnpm -r typecheck && pnpm -r build && pnpm -r test && pnpm -r lint`.
   - Smoke test: `pnpm --filter @rcrsr/rill-ext-anthropic test tests/tool-loop.test.ts`.
2. Update 22 extension `docs/extension-*.md` files that still reference `RILL-R004` to enumerate the generic atoms each extension actually emits. Pattern reference: `packages/ext/vectordb-chroma/docs/extension-vectordb-chroma.md` lines 166–195 (`Failure | Atom | meta.raw.kind` table). Atom inventories: `MIGRATION-0.19.0.md` Phase 2/3/4/6/7/8 sub-tables. Affected packages: built-in (5), LLM (4), search (5), process/protocol (3), HTTP (5).
3. Restore `pnpm.overrides` in root `package.json` to `{}` once `@rcrsr/rill@0.19.0` publishes to npm; re-run `pnpm install` and verify resolution.
4. Tag release `v0.19.0` via `./scripts/release.sh`.

Verification: `grep -rn "RILL-R004" packages/ext/*/docs/ | wc -l` returns 0; `git tag --list 'v0.19.0'` returns the tag.

Commit (docs): `docs(ext)!: document generic-atom error taxonomy across extensions`.
Commit (overrides): `chore: drop local rill override after 0.19.0 publish`.
Commit (release): `chore(release): finalize rill-ext 0.19.0`.

## Phase summary

| Phase | Scope | Packages | Throws migrated | Status |
|---|---|---|---|---|
| A | LLM in-fn | 3 | 50 | pending |
| B | Foundry full | 1 | 34 | pending |
| C | prompt-md docs/comments (audit reclassification) | 1 | 0 | pending |
| D | Docs + verification + release | all | 0 | pending |

Total residual code work: 97 throw-site migrations across 5 packages, plus 22 doc files, plus release ceremony.

## Out of scope

- Further atom additions to rill core. The 12 generic atoms cover every failure mode encountered.
- Sentinel-error indirection (option (b) above) for helper threading. (a) is the chosen pattern.
- Re-litigating Phase 1–3, 5–7 commits. Those packages are confirmed clean.

## Test-fixture reference

Each package needs a `ctx` test stub. Place at `tests/_setup.ts` or inline:

```typescript
import { createRuntimeContext } from '@rcrsr/rill';
const ctx = createRuntimeContext();
// or for narrower needs:
const ctx = {
  signal: new AbortController().signal,
  registerErrorCode: () => {},
  invalidate: (err, meta) => ({ /* RillValue with status */ }),
} as unknown as RuntimeContext;
```

`createRuntimeContext()` from `@rcrsr/rill` is preferred — it returns a real context that supports `invalidate` and matches the production wrapper.
