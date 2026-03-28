#!/usr/bin/env bash
# Create git commit, tag, and push for a release
# Usage: ./scripts/release.sh
#
# This script assumes you've already run /prompt release in pi, which:
# 1. Updated package.json version
# 2. Updated CHANGELOG.md with release entry
#
# The script reads the version from package.json.

set -e

# Read version from package.json
VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

if [ -z "$VERSION" ]; then
  echo "❌ Error: Could not read version from package.json"
  exit 1
fi

if [ "$VERSION" = "0.0.0" ]; then
  echo "❌ Error: Version is still 0.0.0"
  echo ""
  echo "Run /prompt release in pi to prepare the release first."
  exit 1
fi

echo "🚀 Creating release v$VERSION"
echo ""

# Check we're on main branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "❌ Error: Not on main branch (current: $BRANCH)"
  echo "   Run: git checkout main"
  exit 1
fi

# Check CHANGELOG has the version entry
if ! grep -q "## \[$VERSION\]" CHANGELOG.md; then
  echo "❌ Error: CHANGELOG.md missing entry for [$VERSION]"
  echo ""
  echo "Run /prompt release to update CHANGELOG.md first."
  exit 1
fi

# Extract version from CHANGELOG (first versioned entry after Unreleased)
CHANGELOG_VERSION=$(grep -E "^## \[[0-9]+\.[0-9]+\.[0-9]+\]" CHANGELOG.md | head -1 | sed 's/## \[\(.*\)\].*/\1/')

if [ "$CHANGELOG_VERSION" != "$VERSION" ]; then
  echo "❌ Error: Version conflict detected"
  echo ""
  echo "  package.json:  $VERSION"
  echo "  CHANGELOG.md:  $CHANGELOG_VERSION"
  echo ""
  echo "The versions must match. Run /prompt release to fix this."
  exit 1
fi

# Check if tag already exists
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "❌ Error: Git tag v$VERSION already exists"
  echo ""
  echo "This version has already been released."
  echo "Run /prompt release to create a new version."
  exit 1
fi

# Check working directory (should only have package.json and CHANGELOG.md modified)
MODIFIED=$(git status --porcelain | grep -E '^(M| M)' | awk '{print $2}' | sort)
EXPECTED=$(echo -e "CHANGELOG.md\npackage.json" | sort)

if [ "$MODIFIED" != "$EXPECTED" ]; then
  echo "❌ Error: Unexpected file changes detected"
  echo ""
  echo "Expected only:"
  echo "  M CHANGELOG.md"
  echo "  M package.json"
  echo ""
  echo "Found:"
  git status --short
  echo ""
  echo "Commit or stash other changes first."
  exit 1
fi

# Show what will be committed
echo "📝 Changes to be committed:"
echo ""
git diff --stat package.json CHANGELOG.md
echo ""

# Confirm with user
read -p "Create release commit and tag for v$VERSION? [y/N]: " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "❌ Release cancelled"
  exit 1
fi

# Create commit
echo ""
echo "📦 Creating commit..."
git add package.json CHANGELOG.md
git commit -m "chore: release v$VERSION"

# Create tag
echo "🏷️  Creating tag..."
git tag "v$VERSION"

# Push
echo "📤 Pushing to origin..."
git push origin main
git push origin "v$VERSION"

echo ""
echo "✅ Release v$VERSION complete!"
echo ""
echo "View release at:"
echo "  https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/releases/tag/v$VERSION"
echo ""
