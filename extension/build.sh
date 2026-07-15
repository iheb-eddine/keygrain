#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(tr -d "[:space:]" < ../VERSION)

rm -rf dist/
mkdir -p dist/chrome dist/firefox

for target in chrome firefox; do
  cp -r shared/* "dist/$target/"
  cp "$target"/* "dist/$target/"
  sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "dist/$target/manifest.json"
done

# Deterministic, reproducible zips: fixed timestamps, a sorted (LC_ALL=C) file
# list, UTC, and -X to drop platform-specific extra attributes. Because the entry
# order does not depend on filesystem readdir order, the same source yields the
# same SHA-256 on any POSIX machine.
for target in chrome firefox; do
  ( cd "dist/$target"
    find . -type f -exec touch -t 202501010000.00 {} +
    find . -type f | LC_ALL=C sort | TZ=UTC zip -X "../keygrain-$target-$VERSION.zip" -@ )
done
echo "Built: dist/keygrain-chrome-$VERSION.zip, dist/keygrain-firefox-$VERSION.zip"
