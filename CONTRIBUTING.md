# Contributing to rill-ext

Thanks for your interest in rill-ext. This guide covers setup, the change
process, and the standards a pull request must meet before review.

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Security
reports follow the [Security Policy](SECURITY.md) instead of the process below.

## Before you write code

**Open an issue first for anything non-trivial.** Bug fixes and typo corrections
can go straight to a pull request. Everything else starts as an issue so the
design gets settled before you invest in an implementation.

Use the templates under `.github/ISSUE_TEMPLATE/`. Pick the one that matches:
bug, feature, chore, security, or idea.

A new extension, or a new host function on an existing one, is a design
discussion first. What the host function is named, what its parameters are, what
it returns, and which error atoms it can produce are all public surface that a
host script depends on, and they are expensive to change after a release.

**Follow the agreed design.** If you find a reason to depart from it while
implementing, say so in the issue or the pull request description. An unflagged
deviation costs a review cycle and sometimes a rewrite.

**Security work follows the [Security Policy](SECURITY.md).** Its
[threat model](SECURITY.md#threat-model) covers what counts as a vulnerability,
from credential disclosure to sandbox escape.

Report a vulnerability in a published release privately through the
[Security tab](https://github.com/rcrsr/rill-ext/security/advisories/new), not
as a public issue. Hardening work on unreleased code uses the Security issue
template.

## Setup

rill-ext uses Node and pnpm. The required versions live in the root
`package.json`, under `engines` and `packageManager`. Corepack reads the latter
and installs the right pnpm for you, so do not install pnpm globally.

```bash
corepack enable
git clone https://github.com/rcrsr/rill-ext.git
cd rill-ext
pnpm bootstrap
```

`pnpm bootstrap` checks that your Node and pnpm satisfy `engines`, installs
against the committed lockfile, and builds every package. It is the same command
in every repository in the ecosystem, and it is safe to re-run.

Build before you typecheck or test: each package's `tsc --noEmit` reads its
siblings' emitted declarations, so a tree that has never been built fails to
resolve `@rcrsr/rill-ext-*-shared`. `pnpm bootstrap` and the root `pnpm check`
both order this correctly.

`pnpm install` runs `lefthook install`, which registers the git hooks described
below.

## Repository layout

A pnpm workspace. Published extensions live under `packages/ext/`, and the
private packages they bundle at build time live under `packages/shared/`. The
full table of packages, npm names, and vendor SDKs is in [CLAUDE.md](CLAUDE.md).

Shared packages are **bundled into** each consuming extension by `tsup`
(`noExternal`), not published. A change under `packages/shared/` therefore ships
inside every extension that depends on it, without naming it in a diff.

## Commands

Run from the repository root:

```bash
pnpm bootstrap         # Toolchain preconditions, install, build
pnpm check             # Everything below, in order
pnpm build             # Build all packages
pnpm test              # All tests, all packages
pnpm check:types       # Type validation only
pnpm check:lint        # Lint only
pnpm check:format      # Formatting check
pnpm check:deps        # Unused dependencies and exports
pnpm check:standards   # Repository conformance (@rcrsr/rill-dev's REPO-STANDARDS.md)
pnpm check:versions    # Package versions against the root aggregate version
pnpm fix:lint          # Auto-fix lint
pnpm fix:format        # Auto-format
pnpm fix:versions      # Sync package versions to the root major.minor
```

Scope to one package with `--filter`:

```bash
pnpm --filter @rcrsr/rill-ext-anthropic test
cd packages/ext/llm-anthropic && npx vitest run tests/tool-loop.test.ts
```

## The bar for a pull request

**`pnpm check` must pass locally before you request review.** This is the single
most common reason a pull request stalls. Do not rely on CI to find a broken
build for you.

Two failure modes worth calling out, because neither is obvious:

1. **Each package's `tsconfig.json` limits `include` to `src/**/*`.** Type errors
   in test files do not surface in `pnpm check:types`. Run the tests as well as
   the typechecker.
2. **A test file that fails to import reports as a file-level failure, not as
   failing tests.** A suite that never collects can read as "no failures" at a
   glance. Confirm your tests actually execute and that the count is what you
   expect.

Other expectations:

- **Ground rill semantics against the reference.** Fetch
  <https://rill.run/llms.txt> before reasoning about `RillValue` shapes, error
  atoms, callable metadata, or runtime context. It is authoritative over
  anything inferred from this repository.
- **Keep boundary keys snake_case.** Parameter names, keys read from `args`,
  keys in returned dicts, and `returnType` field names are all surface a rill
  script sees. Internal TypeScript stays camelCase; map at the boundary.
- **Reuse rill core's generic error atoms.** `#AUTH`, `#RATE_LIMIT`,
  `#NOT_FOUND` and the rest are pre-registered. Do not define
  `EXT_<NAME>_*` constants and do not re-register a category the taxonomy
  already covers. Provider specifics belong in `meta.provider` and
  `meta.raw.kind`.
- **No internal planning identifiers in shipped source.** `AC-*`, `EC-*`, `IR-*`
  and the rest point at documents that are never published, so they resolve to
  nothing for a reader of the installed package. `rill/no-spec-id-reference`
  enforces this under `packages/*/*/src/`.
- **Let the formatter handle style.** `oxfmt` runs on commit. Do not hand-format,
  and do not fight it.

## Tests

SDK clients are mocked at module level with `vi.mock()`. Tests never make real
API calls, and a test that needs a live service is an integration test that
skips gracefully when the service is unavailable.

### Write tests that could fail

A test that passes before your implementation exists is measuring something
else. Before opening a pull request, check that each new test fails for the
right reason when the change is reverted.

### Test the adversarial case

Every argument reaching a host function comes from a script the host did not
write. For anything that gates, filters, or validates, cover the bypass rather
than only the intended use:

- **Defaults fail closed.** Test what happens with no configuration, no matching
  allowlist entry, and an unrecognised argument type.
- **Every input form reaches the same rule.** A path that skips validation is a
  bypass, not an edge case.
- **Credentials stay out of outputs.** Assert that an error path returns the
  error atom and the provider name, and not the key.
- **Disposal is final.** A call after `dispose()` returns `#DISPOSED` rather
  than acting on a live handle.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with a package
or area scope:

```
feat(llm-gemini): add Vertex AI backend support
fix(fs-s3): reject keys that escape the configured prefix
chore(deps): sweep non-rill dependency bumps
```

Write the subject as a description of the change. State what the code does now,
not how many files you touched.

`lefthook` runs formatting then lint with auto-fix before each commit, piped so
a failing step halts the rest. It runs typecheck, then the full test suite,
before each push. Skip with `LEFTHOOK=0` only when you have a specific
reason.

## Pull requests

1. Branch from `main`. Name it for the work, for example `fix/s3-key-scope` or
   `feat/search-exa-highlights`.
2. Keep it scoped to one concern.
3. Describe the change in terms of source files, host functions, and behaviour.
   Link the issue it implements.
4. Area labels apply automatically from the paths you touched, via
   `.github/labeler.yml`.
5. CI runs the full check across every Node version in the matrix, plus CodeQL,
   dependency review, and the repository standards check. All must pass.

**Do not patch `node_modules/@rcrsr/rill-dev`.** The standards checker and the
custom lint rules ship in that package, whose only source is
[rcrsr/rill](https://github.com/rcrsr/rill) under `packages/dev/`. A local edit
is lost on the next install and leaves every other repository with the broken
behaviour. Fixes go upstream, then arrive here as a dependency bump.

**Do not edit `CHANGELOG.md` or any `version` field.** Both are release-time
actions handled by maintainers.

## Releases

Maintainers publish by tagging a release commit on `main`. Every package shares
the root `major.minor`; each tracks its own patch. Run `pnpm fix:versions` to
sync and `pnpm check:versions` to verify.

An extension's `peerDependency` on `@rcrsr/rill` matches by minor version, so a
rill minor bump requires a matching extension minor bump.

## License

rill-ext is MIT licensed. By contributing, you agree that your contributions are
licensed under the same terms. See [LICENSE](LICENSE).
