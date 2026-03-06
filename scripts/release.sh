#!/bin/bash
set -e

# Rill Extensions Release Script
# Publishes individual extension packages independently.
# Each extension tracks its own version.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

error() {
  echo -e "${RED}ERROR: $1${NC}" >&2
  exit 1
}

info() {
  echo -e "${GREEN}INFO: $1${NC}"
}

warn() {
  echo -e "${YELLOW}WARN: $1${NC}"
}

if [ ! -f "pnpm-workspace.yaml" ]; then
  error "Must run from project root (pnpm-workspace.yaml not found)"
fi

if [ -n "$(git status --porcelain)" ]; then
  error "Working directory not clean. Commit or stash changes before release"
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  warn "Not on main branch (currently on $CURRENT_BRANCH)"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Build all packages
info "Building all packages..."
pnpm run -r build || error "Build failed"

# Run tests
info "Running tests..."
pnpm run -r test || error "Tests failed"

# Discover publishable extension packages
PACKAGES=()
for dir in packages/ext/*/; do
  dir="${dir%/}"
  [ -f "$dir/package.json" ] || continue
  PRIVATE=$(node -p "require('./$dir/package.json').private || false")
  [ "$PRIVATE" = "true" ] && continue
  NAME=$(node -p "require('./$dir/package.json').name")
  VERSION=$(node -p "require('./$dir/package.json').version")
  PACKAGES+=("$dir:$NAME:$VERSION")
done

# Verify publishConfig
info "Verifying publish configuration..."
for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="${pkg%%:*}"
  REST="${pkg#*:}"
  PKG_NAME="${REST%%:*}"
  if ! grep -q '"access": "public"' "$PKG_DIR/package.json"; then
    error "Package $PKG_NAME missing publishConfig.access: \"public\" in $PKG_DIR/package.json"
  fi
done

# Confirm
echo
info "Ready to publish the following packages:"
for pkg in "${PACKAGES[@]}"; do
  REST="${pkg#*:}"
  PKG_NAME="${REST%%:*}"
  PKG_VERSION="${REST#*:}"
  echo "  - $PKG_NAME@$PKG_VERSION"
done

echo
read -p "Proceed with publish? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  info "Release cancelled"
  exit 0
fi

# Publish
info "Publishing packages..."
for pkg in "${PACKAGES[@]}"; do
  PKG_DIR="${pkg%%:*}"
  REST="${pkg#*:}"
  PKG_NAME="${REST%%:*}"
  PKG_VERSION="${REST#*:}"

  if npm view "${PKG_NAME}@${PKG_VERSION}" version &>/dev/null; then
    warn "$PKG_NAME@$PKG_VERSION already published, skipping"
    continue
  fi

  info "Publishing $PKG_NAME@$PKG_VERSION..."
  cd "$PKG_DIR"
  pnpm publish --access public || error "Failed to publish $PKG_NAME"
  cd - > /dev/null

  info "Published $PKG_NAME@$PKG_VERSION successfully"
done

# Create git tags
info "Creating git tags..."
for pkg in "${PACKAGES[@]}"; do
  REST="${pkg#*:}"
  PKG_NAME="${REST%%:*}"
  PKG_VERSION="${REST#*:}"
  TAG="${PKG_NAME}@${PKG_VERSION}"

  if git tag -l "$TAG" | grep -q "$TAG"; then
    warn "Tag $TAG already exists, skipping"
  else
    git tag -a "$TAG" -m "Release $TAG"
    info "Created tag $TAG"
  fi
done

# Push tags
echo
read -p "Push tags to remote? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  info "Pushing tags..."
  git push --tags || error "Failed to push tags"
  info "Tags pushed successfully"
else
  info "Tags created locally but not pushed. Push manually with: git push --tags"
fi

echo
info "Release completed successfully!"
