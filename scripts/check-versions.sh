#!/bin/bash
set -euo pipefail

# Verify every workspace package shares the root package.json major.minor.
#
# The root manifest carries the aggregate version that a release tag matches;
# each package tracks its own patch. Per CLAUDE.md a rill minor bump requires a
# matching extension minor bump, so a package whose major.minor has drifted from
# the root would publish against the wrong runtime range.
#
# Usage: bash scripts/check-versions.sh
# Exit code 0 = all aligned, 1 = mismatch found.

ROOT_VERSION=$(node -p "require('./package.json').version")
ROOT_MAJOR_MINOR="${ROOT_VERSION%.*}"
ERRORS=0
CHECKED=0

# Read the package list to completion before consuming it. A `find ... | while`
# whose body exits early leaves find killed by SIGPIPE, and under pipefail that
# 141 becomes the loop's status, which reads as "no packages" rather than as an
# error.
PKG_MANIFESTS=$(find packages -mindepth 3 -maxdepth 3 -name package.json | sort)

for manifest in $PKG_MANIFESTS; do
  NAME=$(node -p "require('./$manifest').name")
  VERSION=$(node -p "require('./$manifest').version || ''")

  if [ -z "$VERSION" ]; then
    echo "MISSING: $NAME declares no version" >&2
    ERRORS=$((ERRORS + 1))
    continue
  fi

  CHECKED=$((CHECKED + 1))
  if [ "${VERSION%.*}" != "$ROOT_MAJOR_MINOR" ]; then
    echo "MISMATCH: $NAME is $VERSION (expected ${ROOT_MAJOR_MINOR}.x)" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$CHECKED" -eq 0 ]; then
  echo "No workspace packages found under packages/. Check the layout." >&2
  exit 1
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "Found $ERRORS version mismatch(es). Root major.minor: $ROOT_MAJOR_MINOR" >&2
  exit 1
fi

echo "All $CHECKED workspace packages at ${ROOT_MAJOR_MINOR}.x (root: $ROOT_VERSION)"
