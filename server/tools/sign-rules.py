#!/usr/bin/env python3
"""Sign rules.json with Ed25519. Reads server/static/rules.json, writes it back with signature."""
import json, base64, sys
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

TOOLS_DIR = Path(__file__).parent
RULES_PATH = TOOLS_DIR.parent / "static" / "rules.json"
KEY_PATH = TOOLS_DIR / "rules-signing.key"

key_pem = KEY_PATH.read_bytes()
private_key = serialization.load_pem_private_key(key_pem, password=None)

data = json.loads(RULES_PATH.read_text())
payload = json.dumps({"rules": data["rules"], "version": data["version"]}, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
signature = private_key.sign(payload.encode())

data["signature"] = base64.b64encode(signature).decode()
RULES_PATH.write_text(json.dumps(data, indent=2) + "\n")
print(f"Signed rules.json (version {data['version']}, {len(data['rules'])} rules)")
