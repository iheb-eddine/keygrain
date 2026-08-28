#!/bin/bash
set -e
cd "$(dirname "$0")"
node test.mjs
node test-popup-modules.mjs
node test-sync-edit-commit.mjs
node test-diagnostics.mjs
node test-unlock-foundation.mjs
node test-state-manager.mjs
node test-worker-update-version.mjs
node test-identity.mjs
node test-browser-owner-integration.mjs
node test-popup-owner-operations.mjs
node test-totp-contract.mjs
node test-wallet-contract.mjs
node test-ssh-contract.mjs
node test-password-fill-contract.mjs
node test-sync-v3-preservation.mjs
