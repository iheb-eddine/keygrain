#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

rm -rf dist/
mkdir -p dist/chrome dist/firefox

for target in chrome firefox; do
  cp -r shared/* "dist/$target/"
  # Overwrite with browser-specific files (manifest.json, background.js)
  cp "$target"/* "dist/$target/"
done

cd dist/chrome
find . -exec touch -t 202501010000.00 {} +
TZ=UTC zip -rX ../keygrain-chrome.zip .
cd ../firefox
find . -exec touch -t 202501010000.00 {} +
TZ=UTC zip -rX ../keygrain-firefox.zip .
cd ..
echo "Built: dist/keygrain-chrome.zip, dist/keygrain-firefox.zip"
