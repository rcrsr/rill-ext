#!/bin/bash
set -euo pipefail

# Verify every workspace package shares the root package.json major.minor.
#
# The root manifest carries the aggregate version that a release tag matches;
# each package tracks its own patch. Per CLAUDE.md a rill minor bump requires a
# matching extension minor bump, so a package whose major.minor has drifted from
# the root would publish against the wrong runtime range.
#
# major.minor is extracted via explicit regex capture, not suffix-stripping:
# `${VERSION%.*}` mistreats prerelease/build suffixes (e.g. `0.20.1-beta.1`
# strips to `0.20.1-beta`, never matching a `0.20` root), so packages carrying
# a valid prerelease would falsely report as mismatched.
#
# Usage: bash scripts/check-versions.sh
# Exit code 0 = all aligned, 1 = mismatch or unparseable version found.

# Extracts "major.minor" from a semver string on stdout; returns non-zero if
# the string does not start with three dot-separated numeric components.
extract_major_minor() {
  local version="$1"
  if [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.[0-9]+ ]]; then
    echo "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
    return 0
  fi
  return 1
}

ROOT_VERSION=$(node -p "require('./package.json').version")
if ! ROOT_MAJOR_MINOR=$(extract_major_minor "$ROOT_VERSION"); then
  echo "FATAL: root package.json version '$ROOT_VERSION' is not a parseable semver (expected MAJOR.MINOR.PATCH...)" >&2
  exit 1
fi
ERRORS=0
CHECKED=0
FOUND=0

# Read the package list to completion before consuming it. A `find ... | while`
# whose body exits early leaves find killed by SIGPIPE, and under pipefail that
# 141 becomes the loop's status, which reads as "no packages" rather than as an
# error.
PKG_MANIFESTS=$(find packages -mindepth 3 -maxdepth 3 -name package.json | sort)

for manifest in $PKG_MANIFESTS; do
  FOUND=$((FOUND + 1))
  NAME=$(node -p "require('./$manifest').name")
  VERSION=$(node -p "require('./$manifest').version || ''")

  if [ -z "$VERSION" ]; then
    echo "MISSING: $NAME declares no version" >&2
    ERRORS=$((ERRORS + 1))
    continue
  fi

  if ! PKG_MAJOR_MINOR=$(extract_major_minor "$VERSION"); then
    echo "INVALID: $NAME has unparseable version '$VERSION' (expected MAJOR.MINOR.PATCH...)" >&2
    ERRORS=$((ERRORS + 1))
    continue
  fi

  CHECKED=$((CHECKED + 1))
  if [ "$PKG_MAJOR_MINOR" != "$ROOT_MAJOR_MINOR" ]; then
    echo "MISMATCH: $NAME is $VERSION (expected ${ROOT_MAJOR_MINOR}.x)" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$FOUND" -eq 0 ]; then
  echo "No workspace packages found under packages/. Check the layout." >&2
  exit 1
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "Found $ERRORS version mismatch(es). Root major.minor: $ROOT_MAJOR_MINOR" >&2
  exit 1
fi

echo "All $CHECKED workspace packages at ${ROOT_MAJOR_MINOR}.x (root: $ROOT_VERSION)"
