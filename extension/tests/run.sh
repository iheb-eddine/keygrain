#!/bin/bash
set -e
cd "$(dirname "$0")"
node test.mjs
node test-popup-modules.mjs
node test-unlock-foundation.mjs
node test-state-manager.mjs
