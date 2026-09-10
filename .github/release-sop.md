# Release SOP

The written procedure for cutting a `rill-ext` release. `/conduct:cut-release`
reads this file and follows it over its own defaults.

## Version source

- `package.json` at the root is the single source of truth. Set its `version`
  to the release version.
- Then run `pnpm run fix:versions`. It propagates the version to every
  `packages/ext/*/package.json` and `packages/shared/*/package.json`. Do not
  hand-edit member manifests; `pnpm run check:versions` fails CI when one
  drifts.
- No `VERSION` file exists. The version string is plain `MAJOR.MINOR.PATCH`.
- A `@rcrsr/rill` minor bump requires a minor bump here; the extensions'
  `~MAJOR.MINOR.0` peer range must match the rill line they were built
  against.

## Changelogs

- Two tiers: the root `CHANGELOG.md` and one `packages/ext/*/CHANGELOG.md`
  per published extension (27). Shared packages under `packages/shared/` are
  bundled into their consumers and have no changelog; a change to a shared
  package is recorded in every consumer's changelog.
- The root file is the rollup: every entry in a package changelog has a
  corresponding root entry, and the release narrative is written from the
  root file plus the package files, not from the root file alone.
- Heading style is bracketed: `## [Unreleased]` becomes
  `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD`, and a fresh empty `## [Unreleased]`
  is inserted above it. Links are inline (`([#N](https://github.com/rcrsr/rill-ext/pull/N))`);
  there is no reference block at the bottom.
- Categories in use: `Added`, `Changed`, `Changed (Breaking)`, `Removed`,
  `Fixed`, `Security`.
- Entries are authored on the PR, through the changelog command. The release
  only stamps them; it never writes them.

## Pre-stamp gate (mandatory)

Before stamping any changelog, run:

```bash
pnpm run check:changelog
```

It lists every PR squash-merged since the newest `vMAJOR.MINOR.PATCH` tag and
fails when one is not cited (`pull/<N>)`) in any changelog. On failure, STOP the
release. Author the missing entries under `[Unreleased]` in the root file and
in every affected package file, merge them, then re-run the release.

The root `[Unreleased]` section must be non-empty. A package file whose
`[Unreleased]` section is empty is still stamped, so every package carries a
`[MAJOR.MINOR.PATCH]` heading for the line it was published on.

## Branch, commit, tag

- Branch: `release/MAJOR.MINOR.PATCH`
- Commit: `chore(release): MAJOR.MINOR.PATCH`
- PR title: `Release MAJOR.MINOR.PATCH`, squash-merged with subject
  `chore(release): MAJOR.MINOR.PATCH (#PR)`
- Tag: annotated `vMAJOR.MINOR.PATCH` on the squash-merge commit on `main`

## What the tag triggers

Pushing `vMAJOR.MINOR.PATCH` runs `.github/workflows/release.yml`. It asserts
the tag matches the root `version`, runs `check:versions`, builds, tests, then
publishes every non-private `packages/ext/*` whose `name@version` is not yet on
npm, and creates the GitHub release with `--generate-notes`.

Do not create the GitHub release by hand; the workflow owns it. After the
workflow completes, replace the generated notes with the PR narrative:

```bash
gh release edit vMAJOR.MINOR.PATCH --notes-file <narrative.md>
```

Published tarballs contain `dist/` only. A changelog correction after a
release is a docs PR on `main`; it does not require a republish.

## Release PR narrative

The PR body opens with prose, one paragraph per theme, drawn from every
stamped `[MAJOR.MINOR.PATCH]` section (root and packages). Each fixed issue is
named at least once, by package. A `## Changes` section follows, grouped by
category, reproducing the root entries.
