#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

rm -rf dist/
mkdir -p dist/chrome dist/firefox

for target in chrome firefox; do
  cp -r shared/* "dist/$target/"
  cp "$target/manifest.json" "dist/$target/"
done

cd dist/chrome
zip -r ../keygrain-chrome.zip .
cd ../firefox
zip -r ../keygrain-firefox.zip .
cd ..
echo "Built: dist/keygrain-chrome.zip, dist/keygrain-firefox.zip"
