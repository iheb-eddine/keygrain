#!/bin/sh
set -e

ROOT_VERSION=$(cat VERSION)
if ! echo "$ROOT_VERSION" | grep -Exq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "ERROR: VERSION format invalid: '$ROOT_VERSION'"
  exit 1
fi

MINOR=$(echo "$ROOT_VERSION" | cut -d. -f2)
PATCH=$(echo "$ROOT_VERSION" | cut -d. -f3)
if [ "$MINOR" -ge 100 ] || [ "$PATCH" -ge 100 ]; then
  echo "ERROR: MINOR ($MINOR) and PATCH ($PATCH) must be < 100 for versionCode"
  exit 1
fi

ERR=0
check() {
  val=$(eval "$2") || val=""
  if [ -z "$val" ]; then
    echo "ERROR: Could not extract version from $1"
    ERR=1
  elif [ "$val" != "$ROOT_VERSION" ]; then
    echo "MISMATCH: $1"
    echo "  expected: $ROOT_VERSION"
    echo "  actual:   $val"
    ERR=1
  fi
}

check "extension/chrome/manifest.json" "grep -o '\"version\": *\"[^\"]*\"' extension/chrome/manifest.json | head -1 | grep -o '[0-9][0-9.]*'"
check "extension/firefox/manifest.json" "grep -o '\"version\": *\"[^\"]*\"' extension/firefox/manifest.json | head -1 | grep -o '[0-9][0-9.]*'"
check "python/pyproject.toml" "grep '^version' python/pyproject.toml | head -1 | grep -o '[0-9][0-9.]*'"

if [ "$ERR" -ne 0 ]; then
  exit 1
fi
echo "✓ All versions match: $ROOT_VERSION"
