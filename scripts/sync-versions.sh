#!/bin/bash
set -euo pipefail

# Sync major.minor from the root package.json to every workspace package,
# preserving each package's own patch. The inverse of scripts/check-versions.sh.
#
# Usage: bash scripts/sync-versions.sh

ROOT_VERSION=$(node -p "require('./package.json').version")
ROOT_MAJOR_MINOR="${ROOT_VERSION%.*}"
UPDATED=0

# Read to completion before consuming; see the note in check-versions.sh.
PKG_MANIFESTS=$(find packages -mindepth 3 -maxdepth 3 -name package.json | sort)

for manifest in $PKG_MANIFESTS; do
  CURRENT=$(node -p "require('./$manifest').version || ''")
  [ -n "$CURRENT" ] || continue

  if [ "${CURRENT%.*}" != "$ROOT_MAJOR_MINOR" ]; then
    NEW_VERSION="${ROOT_MAJOR_MINOR}.${CURRENT##*.}"
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
  fi
done

if [ "$UPDATED" -eq 0 ]; then
  echo "All packages already at ${ROOT_MAJOR_MINOR}.x"
else
  echo "Updated $UPDATED package(s) to ${ROOT_MAJOR_MINOR}.x"
fi
