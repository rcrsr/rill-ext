#!/bin/bash
set -euo pipefail

# Sync major.minor from the root package.json to every workspace package,
# preserving each package's own patch (and any prerelease/build suffix). The
# inverse of scripts/check-versions.sh.
#
# major.minor is extracted via explicit regex capture, not suffix-stripping:
# `${CURRENT##*.}` on `0.20.1-beta.1` yields `1`, so a naive rewrite would
# silently drop the prerelease tag and produce `0.20.1` with no diagnostic.
# Capturing the patch digits and everything after them preserves the suffix
# verbatim across the rewrite.
#
# Usage: bash scripts/sync-versions.sh

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
UPDATED=0
UPDATED_MANIFESTS=()

# Read to completion before consuming; see the note in check-versions.sh.
PKG_MANIFESTS=$(find packages -mindepth 3 -maxdepth 3 -name package.json | sort)

for manifest in $PKG_MANIFESTS; do
  CURRENT=$(node -p "require('./$manifest').version || ''")
  [ -n "$CURRENT" ] || continue

  if [[ "$CURRENT" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+.*)$ ]]; then
    CURRENT_MAJOR_MINOR="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
    CURRENT_PATCH_AND_SUFFIX="${BASH_REMATCH[3]}"
  else
    echo "FATAL: $manifest has unparseable version '$CURRENT' (expected MAJOR.MINOR.PATCH...)" >&2
    exit 1
  fi

  if [ "$CURRENT_MAJOR_MINOR" != "$ROOT_MAJOR_MINOR" ]; then
    NEW_VERSION="${ROOT_MAJOR_MINOR}.${CURRENT_PATCH_AND_SUFFIX}"
    NEW_VERSION="$NEW_VERSION" PKG_PATH="./$manifest" node -e "
      const fs = require('fs');
      const path = process.env.PKG_PATH;
      const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
      pkg.version = process.env.NEW_VERSION;
      fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
    "
    NAME=$(node -p "require('./$manifest').name")
    echo "  $NAME: $CURRENT -> $NEW_VERSION"
    UPDATED=$((UPDATED + 1))
    UPDATED_MANIFESTS+=("$manifest")
  fi
done

if [ "$UPDATED" -eq 0 ]; then
  echo "All packages already at ${ROOT_MAJOR_MINOR}.x"
else
  echo "Updated $UPDATED package(s) to ${ROOT_MAJOR_MINOR}.x"

  # The rewrite above round-trips every manifest through JSON.stringify, which
  # normalizes line endings and depends on oxfmt continuing to accept that
  # exact style. Verify it here so a style divergence fails loudly instead of
  # drifting silently into a later, unrelated CI failure.
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "FATAL: pnpm not found; cannot verify formatting of updated manifest(s): ${UPDATED_MANIFESTS[*]}" >&2
    exit 1
  fi
  if ! pnpm exec oxfmt --check "${UPDATED_MANIFESTS[@]}"; then
    echo "FATAL: oxfmt formatting check failed for updated manifest(s). Run 'pnpm exec oxfmt' on them." >&2
    exit 1
  fi
fi
