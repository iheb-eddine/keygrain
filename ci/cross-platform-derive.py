#!/usr/bin/env python3
"""Derive passwords for specified vector indices. Prints passwords to stdout, status to stderr."""
import json
import sys
from pathlib import Path

from keygrain.derive import derive_password

vectors = json.loads((Path(__file__).resolve().parent.parent / "vectors.json").read_text())["vectors"]

for idx in (int(a) for a in sys.argv[1:]):
    v = vectors[idx]
    secret = v["secret_utf8"].encode("utf-8")
    pw = derive_password(secret, v["email"], site=v["site"], length=v["length"], symbols=v["symbols"], counter=v["counter"])
    if pw != v["expected"]:
        print(f"✗ [py] vectors[{idx}] mismatch: got {pw!r}, expected {v['expected']!r}", file=sys.stderr)
        sys.exit(1)
    print(f"✓ [py] vectors[{idx}] {v['site']} len={v['length']}: {pw}", file=sys.stderr)
    print(pw)
