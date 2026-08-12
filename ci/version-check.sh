#!/bin/sh
set -e

# Independent per-component version validation.
#
# Each client component owns its version in its own ecosystem manifest. There is NO
# shared VERSION file and NO cross-component equality requirement — components release
# on independent cadences (chrome/firefox/android/cli each version separately).
# Deployment-side version checks are maintained by the deployment system separately.
#
# Sources of truth:
#   chrome  -> extension/chrome/manifest.json
#   firefox -> extension/firefox/manifest.json
#   cli     -> python/pyproject.toml
#   android -> kotlin/VERSION   (drives versionName + versionCode in app/build.gradle.kts)
#
# This script runs INSIDE the public keygrain/ repo (GitLab CI + GitHub Actions) and
# validates only public client manifests. Deployment and release-coordination checks
# live in their respective deployment workflows.

ERR=0

semver_ok() {
  echo "$1" | grep -Exq '^[0-9]+\.[0-9]+\.[0-9]+$'
}

check_format() {
  # $1 = label, $2 = extracted version
  if [ -z "$2" ]; then
    echo "ERROR: could not extract version from $1"
    ERR=1
  elif ! semver_ok "$2"; then
    echo "ERROR: $1 version is not MAJOR.MINOR.PATCH: '$2'"
    ERR=1
  else
    echo "  $1: $2"
  fi
}

CHROME=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' extension/chrome/manifest.json | head -1 | grep -o '[0-9][0-9.]*')
FIREFOX=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' extension/firefox/manifest.json | head -1 | grep -o '[0-9][0-9.]*')
CLI=$(grep '^version' python/pyproject.toml | head -1 | grep -o '[0-9][0-9.]*')
ANDROID=$(tr -d '[:space:]' < kotlin/VERSION)

check_format "extension/chrome/manifest.json" "$CHROME"
check_format "extension/firefox/manifest.json" "$FIREFOX"
check_format "python/pyproject.toml" "$CLI"
check_format "kotlin/VERSION" "$ANDROID"

# Android versionCode = MAJOR*10000 + MINOR*100 + PATCH, so MINOR and PATCH must be < 100.
if semver_ok "$ANDROID"; then
  AMIN=$(echo "$ANDROID" | cut -d. -f2)
  APATCH=$(echo "$ANDROID" | cut -d. -f3)
  if [ "$AMIN" -ge 100 ] || [ "$APATCH" -ge 100 ]; then
    echo "ERROR: kotlin/VERSION MINOR ($AMIN) and PATCH ($APATCH) must be < 100 for versionCode"
    ERR=1
  fi
fi

if [ "$ERR" -ne 0 ]; then
  exit 1
fi
echo "✓ All component versions valid (independent per-component versioning)"
