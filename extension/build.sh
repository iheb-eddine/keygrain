#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

rm -rf dist/
mkdir -p dist/chrome dist/firefox

for target in chrome firefox; do
  cp -r shared/* "dist/$target/"
  cp "$target/manifest.json" "dist/$target/"
done

cd dist
zip -r keygrain-chrome.zip chrome/
zip -r keygrain-firefox.zip firefox/
echo "Built: dist/keygrain-chrome.zip, dist/keygrain-firefox.zip"
