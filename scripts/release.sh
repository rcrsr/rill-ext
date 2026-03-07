#!/bin/bash
set -e

# Rill Extensions Release Script
# Validates, creates a version tag, and pushes to trigger CI release.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

error() { echo -e "${RED}ERROR: $1${NC}" >&2; exit 1; }
info() { echo -e "${GREEN}INFO: $1${NC}"; }
warn() { echo -e "${YELLOW}WARN: $1${NC}"; }

[ -f "pnpm-workspace.yaml" ] || error "Must run from project root"
[ -z "$(git status --porcelain)" ] || error "Working directory not clean"

git fetch --tags || error "Failed to fetch tags"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  warn "Not on main branch (currently on $CURRENT_BRANCH)"
  read -p "Continue anyway? (y/N) " -n 1 -r; echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

info "Building all packages..."
pnpm run -r build || error "Build failed"

info "Running tests..."
pnpm run -r test || error "Tests failed"

# Extract version from root package.json
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

if git tag -l "$TAG" | grep -q "$TAG"; then
  error "Tag $TAG already exists"
fi

# Show what will be published
info "Packages with pending changes:"
for dir in packages/ext/*/; do
  dir="${dir%/}"
  [ -f "$dir/package.json" ] || continue
  PRIVATE=$(node -p "require('./$dir/package.json').private || false")
  [ "$PRIVATE" = "true" ] && continue
  NAME=$(node -p "require('./$dir/package.json').name")
  VERSION=$(node -p "require('./$dir/package.json').version")
  if npm view "${NAME}@${VERSION}" version &>/dev/null; then
    echo "  - $NAME@$VERSION (already published, skip)"
  else
    echo "  - $NAME@$VERSION (new)"
  fi
done

echo
info "CI will publish after pushing $TAG"
read -p "Create tag and push? (y/N) " -n 1 -r; echo
[[ $REPLY =~ ^[Yy]$ ]] || { info "Release cancelled"; exit 0; }

git tag -a "$TAG" -m "Release $TAG"
info "Created tag $TAG"

git push origin "$TAG" || error "Failed to push tag"
info "Pushed $TAG — CI release triggered"
