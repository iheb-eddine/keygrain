#!/bin/bash
set -e

# Idempotent server setup for keygrain.
# Run once on a fresh server, or re-run safely after config changes.
# Usage: ./setup-server.sh [path-to-env-file]
#
# Config is read from (in order):
#   1. Environment variables (e.g., from CI pipeline)
#   2. .env file passed as argument
#   3. /opt/keygrain/.env (if exists from previous setup)

ENV_FILE="${1:-}"

# Load config from file if provided or if default exists
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
    set -a; source "$ENV_FILE"; set +a
elif [ -f "/opt/keygrain/.env" ]; then
    set -a; source "/opt/keygrain/.env"; set +a
fi

# Defaults (can be overridden by env vars or .env file)
DOMAIN="${DOMAIN:-keygrain.secbytech.com}"
APP_PORT="${APP_PORT:-9860}"
APP_DIR="${APP_DIR:-/opt/keygrain}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@secbytech.com}"

echo "=== Keygrain server setup ==="
echo "Domain: ${DOMAIN}"
echo "Port: ${APP_PORT}"
echo "App dir: ${APP_DIR}"

# --- 1. Install dependencies (idempotent) ---
install_if_missing() {
    if ! command -v "$1" &>/dev/null; then
        echo "Installing $1..."
        apt-get update -qq && apt-get install -y -qq "$2"
    fi
}

install_if_missing nginx nginx
install_if_missing certbot certbot
install_if_missing docker docker.io

# Ensure docker compose plugin is available
if ! docker compose version &>/dev/null; then
    apt-get update -qq && apt-get install -y -qq docker-compose-plugin
fi

# --- 2. Create app directory ---
mkdir -p "${APP_DIR}/data"
mkdir -p "${APP_DIR}/static/app"

# Save config for future runs
cat > "${APP_DIR}/.env" <<EOF
DOMAIN=${DOMAIN}
APP_PORT=${APP_PORT}
APP_DIR=${APP_DIR}
CERTBOT_EMAIL=${CERTBOT_EMAIL}
EOF

# --- 3. Nginx config (idempotent) ---
NGINX_CONF="/etc/nginx/sites-available/keygrain.conf"
mkdir -p /var/www/certbot

# Write nginx config (always overwrite to pick up changes)
cat > "${NGINX_CONF}" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/keygrain.conf

# --- 4. SSL certificate (idempotent — skips if already exists) ---
if [ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
    echo "Obtaining SSL certificate for ${DOMAIN}..."
    # Temporarily enable HTTP-only nginx for ACME challenge
    TMP_CONF="/etc/nginx/sites-available/keygrain-http-only.conf"
    cat > "${TMP_CONF}" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 444; }
}
EOF
    ln -sf "${TMP_CONF}" /etc/nginx/sites-enabled/keygrain-http-only.conf
    rm -f /etc/nginx/sites-enabled/keygrain.conf
    nginx -t && systemctl reload nginx

    certbot certonly --webroot -w /var/www/certbot \
        -d "${DOMAIN}" \
        --email "${CERTBOT_EMAIL}" --agree-tos --no-eff-email --non-interactive

    # Restore full config
    rm -f /etc/nginx/sites-enabled/keygrain-http-only.conf
    rm -f "${TMP_CONF}"
    ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/keygrain.conf
else
    echo "SSL certificate already exists for ${DOMAIN}, skipping."
fi

# --- 5. Reload nginx ---
nginx -t && systemctl reload nginx
echo "Nginx configured and running."

# --- 6. Certbot auto-renewal (idempotent) ---
if ! systemctl is-enabled certbot.timer &>/dev/null; then
    systemctl enable --now certbot.timer 2>/dev/null || true
fi

# --- 7. Docker service ---
systemctl enable --now docker 2>/dev/null || true

echo "=== Setup complete ==="
echo "Server ready for deployment. Push to master to trigger CI deploy."
