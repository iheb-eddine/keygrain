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
# list, UTC, normalised file modes, and -X to drop platform-specific extra
# attributes. Because the entry order does not depend on filesystem readdir order,
# the same source yields the same SHA-256 on any POSIX machine.
#
# Two things must be normalised explicitly or the output is NOT cross-machine
# reproducible (both were bugs found on 2026-07-28 by comparing a local build
# against the CI build of the same commit):
#   1. Timezone. `touch -t` interprets its argument in LOCAL time, so a fixed
#      stamp lands on a different instant per timezone and zip records a
#      different DOS time. TZ=UTC is exported for the whole loop so `touch` and
#      `zip` agree.
#   2. File modes. zip stores the Unix mode in each central-directory entry, and
#      -X does not strip it, so a builder's umask leaks into the archive
#      (0644 vs 0664). Modes are forced to 644 before zipping.
export TZ=UTC
for target in chrome firefox; do
  cp -r shared/* "dist/$target/"
  cp "$target"/* "dist/$target/"
  V=$(extract_version "dist/$target/manifest.json")
  if [ -z "$V" ]; then
    echo "ERROR: could not read version from $target/manifest.json" >&2
    exit 1
  fi
  ( cd "dist/$target"
    find . -type f -exec chmod 644 {} +
    find . -type f -exec touch -t 202501010000.00 {} +
    find . -type f | LC_ALL=C sort | zip -X "../keygrain-$target-$V.zip" -@ )
  echo "Built: dist/keygrain-$target-$V.zip"
done
