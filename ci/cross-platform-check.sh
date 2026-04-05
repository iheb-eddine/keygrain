#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PY_OUT=$(PYTHONPATH="$ROOT/python" python3 "$SCRIPT_DIR/cross-platform-derive.py" 0 4)
JS_OUT=$(node "$SCRIPT_DIR/cross-platform-derive.mjs" 0 4)

if [ "$PY_OUT" != "$JS_OUT" ]; then
  echo "DRIFT DETECTED"
  echo "  Python: $PY_OUT"
  echo "  JS:     $JS_OUT"
  exit 1
fi
echo "✓ Cross-platform outputs match"
