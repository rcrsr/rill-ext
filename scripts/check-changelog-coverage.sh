#!/bin/bash
set -euo pipefail

# Verify every pull request merged since the last release tag is cited in at
# least one CHANGELOG.md.
#
# The release skill stamps whatever sits under `## [Unreleased]`; it does not
# read git history. A PR that lands without a changelog entry is therefore
# silently absent from the release notes (0.21.0 shipped 15 bug fixes from
# #102 this way). This gate runs before stamping and fails the release until
# every merged PR has an entry.
#
# A PR is "cited" when any changelog contains `pull/<number>)`, the link form
# every entry in this repository uses. Release commits (`chore(release):`)
# are exempt: they are the stamp itself.
#
# Usage: bash scripts/check-changelog-coverage.sh [BASE_REF]
#   BASE_REF defaults to the newest clean vMAJOR.MINOR.PATCH tag.
# Exit code 0 = every merged PR is cited, 1 = at least one is missing.

if [ $# -ge 1 ]; then
  BASE_REF="$1"
else
  BASE_REF=$(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)
fi

if [ -z "$BASE_REF" ]; then
  echo "FATAL: no vMAJOR.MINOR.PATCH tag found and no BASE_REF given" >&2
  exit 1
fi

CHANGELOGS=$(git ls-files 'CHANGELOG.md' '*/CHANGELOG.md')
if [ -z "$CHANGELOGS" ]; then
  echo "FATAL: no CHANGELOG.md tracked in this repository" >&2
  exit 1
fi

# Squash-merge subjects end in "(#N)". Read the list to completion before
# consuming it so an early exit in the loop cannot leave git killed by SIGPIPE.
SUBJECTS=$(git log --format=%s "$BASE_REF..HEAD")

MISSING=0
CHECKED=0
while IFS= read -r subject; do
  [ -z "$subject" ] && continue
  case "$subject" in chore\(release\):*) continue ;; esac
  if [[ "$subject" =~ \(#([0-9]+)\)[[:space:]]*$ ]]; then
    number="${BASH_REMATCH[1]}"
  else
    continue
  fi
  CHECKED=$((CHECKED + 1))
  if ! grep -q "pull/$number)" $CHANGELOGS; then
    echo "MISSING: #$number has no changelog entry — $subject" >&2
    MISSING=$((MISSING + 1))
  fi
done <<< "$SUBJECTS"

if [ "$MISSING" -gt 0 ]; then
  echo "$MISSING of $CHECKED merged PR(s) since $BASE_REF are absent from every CHANGELOG.md. Author entries under [Unreleased] before releasing." >&2
  exit 1
fi

echo "All $CHECKED merged PR(s) since $BASE_REF are cited in a CHANGELOG.md"
