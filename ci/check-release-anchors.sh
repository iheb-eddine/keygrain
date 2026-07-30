#!/usr/bin/env bash
#
# Release-anchor gate.
#
# VERIFY.md tells users: check out the tag for the version you installed, rebuild
# it, and compare against SHA256SUMS.txt on the matching GitHub Release. That
# promise needs TWO public artifacts to exist for every shipped client version:
#
#   1. a tag on the PUBLIC repo, and
#   2. a published GitHub Release for it, carrying SHA256SUMS.txt.
#
# Ops tags are invisible to users and do not count.
#
# This broke once already: decoupling per-component versions (4c96317, 2026-07-25)
# moved tagging to the private ops repo, the public repo stopped getting tags, and
# extension 1.1.0 shipped with no anchor at all — while VERIFY.md still told people
# to `git checkout v<version>`. Nothing detected it; a human noticed weeks later.
# This script is that detector.
#
# Usage:
#   ci/check-release-anchors.sh [owner/repo] [tag ...]
#
#   No tags given -> checks every local tag matching a client component prefix.
#   Tags given    -> checks exactly those (used by release.yml on the tag it just
#                    published, so a broken release fails its own pipeline).
#
# Needs only curl; reads the public GitHub API anonymously. Set GITHUB_TOKEN to
# raise the rate limit if you hit it.

set -uo pipefail

REPO="${1:-iheb-eddine/keygrain}"
shift || true

API="https://api.github.com/repos/${REPO}"
AUTH=()
[ -n "${GITHUB_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer ${GITHUB_TOKEN}")

api() {
  curl -fsSL "${AUTH[@]}" -H "Accept: application/vnd.github+json" "$1" 2>/dev/null
}

# Which tags carry a user-installable client and therefore need an anchor.
#
# Legacy `vX.Y.Z` tags are deliberately NOT checked: they predate per-component
# versioning, and v0.11.0 was published with no assets at all. Enforcing the rule
# retroactively would mean either a permanently red pipeline or back-filling
# checksums we cannot prove — see release-notes/README.md.
COMPONENT_TAG_RE='^(chrome|firefox)-v[0-9]+\.[0-9]+\.[0-9]+$'

if [ "$#" -gt 0 ]; then
  TAGS=("$@")
else
  mapfile -t TAGS < <(git tag | grep -E "$COMPONENT_TAG_RE" | sort)
fi

if [ "${#TAGS[@]}" -eq 0 ]; then
  echo "No client component tags found — nothing to check."
  exit 0
fi

status=0
checked=0

for tag in "${TAGS[@]}"; do
  # Tags handed in explicitly may be for another component (e.g. cli-v*). Skip
  # them rather than fail: they have their own publishing path and no zips.
  if ! printf '%s' "$tag" | grep -qE "$COMPONENT_TAG_RE"; then
    echo "SKIP  $tag  (not a browser-extension tag)"
    continue
  fi

  checked=$((checked + 1))
  version="${tag##*-v}"
  browser="${tag%%-v*}"
  problems=()

  # 1. The tag must exist on the remote, not just locally. A tag that was never
  #    pushed is the exact 1.1.0 failure mode.
  if ! api "${API}/git/ref/tags/${tag}" >/dev/null; then
    problems+=("tag is not on the public remote (push it to origin AND github)")
  fi

  # 2. A published (non-draft) release must exist for it.
  release_json=$(api "${API}/releases/tags/${tag}")
  if [ -z "$release_json" ]; then
    problems+=("no published GitHub Release for this tag (a draft does not count)")
  else
    assets=$(printf '%s' "$release_json" \
      | grep -o '"name": *"[^"]*"' | sed 's/.*: *"//; s/"$//')

    # 3. It must carry the checksum file and this browser's zip.
    printf '%s\n' "$assets" | grep -qx 'SHA256SUMS.txt' \
      || problems+=("release has no SHA256SUMS.txt — VERIFY.md's Method A cannot be completed")
    printf '%s\n' "$assets" | grep -qx "keygrain-${browser}-${version}.zip" \
      || problems+=("release has no keygrain-${browser}-${version}.zip")
  fi

  if [ "${#problems[@]}" -eq 0 ]; then
    echo "OK    $tag"
  else
    status=1
    echo "FAIL  $tag"
    for p in "${problems[@]}"; do
      echo "        - $p"
    done
  fi
done

echo
if [ "$status" -eq 0 ]; then
  echo "✓ All $checked client release(s) have a public tag, a release, and checksums."
else
  echo "✗ At least one shipped client version has no usable public verification anchor."
  echo "  VERIFY.md promises users they can verify by hash. Fix the release, or"
  echo "  correct VERIFY.md's coverage section — do not leave the promise unbacked."
  echo "  Procedure: release-notes/README.md, 'Public verification anchors'."
fi
exit $status
