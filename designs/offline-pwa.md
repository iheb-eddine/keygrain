# Offline PWA Support for /generate/

The web generator is a single self-contained HTML file. PWA support enables install-to-homescreen and offline use.

## Components
- `manifest.json` — app metadata (name, icon, display: standalone)
- `sw.js` — service worker using stale-while-revalidate (serve from cache, update in background)
- HTML additions — manifest link + SW registration

## Cache Strategy
Cache-first with background revalidation. Cached assets: `./`, `./index.html`, `./icon-128.png`.

## Icon
Uses `keygrain-128x128.png` (copied from `logo/`).
