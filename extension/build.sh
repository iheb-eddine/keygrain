#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

rm -rf dist/
mkdir -p dist/chrome dist/firefox

# Each extension carries its own version in its own manifest.json — that manifest is
# the single source of truth. build.sh no longer stamps a shared version, so Chrome
# and Firefox version independently.
extract_version() {
  grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" | head -1 | grep -o '[0-9][0-9.]*'
}

# Deterministic, reproducible zips: fixed timestamps, a sorted (LC_ALL=C) file
# list, UTC, and -X to drop platform-specific extra attributes. Because the entry
# order does not depend on filesystem readdir order, the same source yields the
# same SHA-256 on any POSIX machine.
for target in chrome firefox; do
  cp -r shared/* "dist/$target/"
  cp "$target"/* "dist/$target/"
  V=$(extract_version "dist/$target/manifest.json")
  if [ -z "$V" ]; then
    echo "ERROR: could not read version from $target/manifest.json" >&2
    exit 1
  fi
  ( cd "dist/$target"
    find . -type f -exec touch -t 202501010000.00 {} +
    find . -type f | LC_ALL=C sort | TZ=UTC zip -X "../keygrain-$target-$V.zip" -@ )
  echo "Built: dist/keygrain-$target-$V.zip"
done
