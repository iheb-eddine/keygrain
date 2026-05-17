# Self-Hosting the Sync Server

## Prerequisites

- A Linux server with Docker installed
- A domain with DNS A record pointing to your server
- Ports 80 and 443 open

## Setup (3 steps)

```bash
# 1. Clone and enter the server directory
git clone git@dev.secbytech.com:tools/keygrain.git
cd keygrain/server

# 2. Configure
cp deploy/.env.template .env
# Edit .env — set DOMAIN and CERTBOT_EMAIL at minimum

# 3. Provision and start
sudo bash deploy/setup-server.sh .env
docker compose up -d
```

`setup-server.sh` installs nginx, obtains a Let's Encrypt TLS certificate, and configures the reverse proxy. Run it once on a fresh server (idempotent — safe to re-run).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DOMAIN` | `keygrain.com` | Your server's domain |
| `APP_PORT` | `9860` | Internal container port |
| `APP_DIR` | `/opt/keygrain` | App directory on host |
| `CERTBOT_EMAIL` | `admin@keygrain.com` | Email for Let's Encrypt notifications |
| `KEYGRAIN_RATE_LIMIT_TRUSTED_HEADER` | `X-Real-IP` | Header for rate limiting (set by nginx) |

## Architecture

```
Internet → nginx (443/TLS) → 127.0.0.1:9860 → keygrain container
```

The container binds to localhost only. Nginx handles TLS termination and sets `X-Real-IP` for rate limiting.

## Data Backup

The encrypted blob data lives in the `keygrain_data` Docker volume:

```bash
# Find volume path
docker volume inspect keygrain_data --format '{{.Mountpoint}}'

# Backup
cp -r /var/lib/docker/volumes/keygrain_data/_data /path/to/backup/
```

## Monitoring

Health check:

```bash
curl https://your-domain.com/health
# {"status":"ok"}
```

TLS certificates auto-renew via certbot timer (configured by `setup-server.sh`).

## Client Configuration

Point the browser extension or Android app to your server:

- **Extension:** Settings → Sync Server → `https://your-domain.com`
- **Android:** Settings → Server URL → `https://your-domain.com`
