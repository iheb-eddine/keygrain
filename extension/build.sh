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

cd dist/chrome
find . -exec touch -t 202501010000.00 {} +
TZ=UTC zip -rX "../keygrain-chrome-$VERSION.zip" .
cd ../firefox
find . -exec touch -t 202501010000.00 {} +
TZ=UTC zip -rX "../keygrain-firefox-$VERSION.zip" .
cd ..
echo "Built: dist/keygrain-chrome-$VERSION.zip, dist/keygrain-firefox-$VERSION.zip"
