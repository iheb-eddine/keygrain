#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VECTOR_COUNT=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["vectors"]))' "$ROOT/vectors.json")
if [ "$VECTOR_COUNT" -lt 1 ]; then
  echo "ERROR: vectors.json contains no password vectors" >&2
  exit 1
fi
INDICES=$(python3 -c 'print(" ".join(map(str, range(int(__import__("sys").argv[1])))))' "$VECTOR_COUNT")

PY_OUT=$(PYTHONPATH="$ROOT/python" python3 "$SCRIPT_DIR/cross-platform-derive.py" $INDICES)
JS_OUT=$(node "$SCRIPT_DIR/cross-platform-derive.mjs" $INDICES)

if [ "$PY_OUT" != "$JS_OUT" ]; then
  echo "DRIFT DETECTED: password vectors" >&2
  echo "  Python: $PY_OUT" >&2
  echo "  JS:     $JS_OUT" >&2
  exit 1
fi
echo "✓ Password outputs match for all $VECTOR_COUNT vectors"

PY_FAMILY=$(PYTHONPATH="$ROOT/python" python3 "$SCRIPT_DIR/cross-platform-families.py")
JS_FAMILY=$(node "$SCRIPT_DIR/cross-platform-families.mjs")

python3 - "$PY_FAMILY" "$JS_FAMILY" <<'PY'
import json
import sys

python_result = json.loads(sys.argv[1])
js_result = json.loads(sys.argv[2])
if python_result != js_result:
    print("DRIFT DETECTED: TOTP/SSH/wallet/sync family outputs", file=sys.stderr)
    for family in ("totp_rfc", "totp_derived", "ssh", "wallet", "sync"):
        if python_result.get(family) != js_result.get(family):
            print(f"  family mismatch: {family}", file=sys.stderr)
    raise SystemExit(1)
print("✓ TOTP, SSH, wallet, and sync outputs match between Python and JS")
PY
