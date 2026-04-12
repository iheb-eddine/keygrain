#!/bin/bash
set -e

# Deploy keygrain. Assumes setup-server.sh has been run at least once.
# Config is read from /opt/keygrain/.env or environment variables.

if [ -f "/opt/keygrain/.env" ]; then
    set -a; source "/opt/keygrain/.env"; set +a
fi

APP_DIR="${APP_DIR:-/opt/keygrain}"
TARBALL="/tmp/keygrain.tar.gz"
DEPLOY_DIR="/tmp/keygrain-deploy"

cleanup() { rm -rf "${DEPLOY_DIR}" "${TARBALL}"; }
trap cleanup EXIT

echo "Extracting deployment package..."
mkdir -p "${DEPLOY_DIR}"
tar -xzf "${TARBALL}" -C "${DEPLOY_DIR}"

# Stop current container
if [ -f "${APP_DIR}/docker-compose.yml" ]; then
    cd "${APP_DIR}" && docker compose down || true
fi

# Deploy new files (preserve .env and data volume)
rm -f "${APP_DIR}"/*.go
cp -r "${DEPLOY_DIR}"/app/* "${APP_DIR}/"

# Build and start
cd "${APP_DIR}"
docker compose build
docker compose up -d

# Reload nginx to pick up any cert changes
nginx -t && systemctl reload nginx

echo "Keygrain deployed successfully!"
