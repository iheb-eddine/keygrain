#!/usr/bin/env python3
"""Derive every shared family fixture using the Python reference APIs.

The output is compared structurally with ci/cross-platform-families.mjs. Fixture
expected-output fields are deliberately not read for the comparison.
"""
import json
from pathlib import Path

from keygrain.ssh import derive_ssh_keypair, format_authorized_keys
from keygrain.sync_client import (
    derive_auth_password,
    derive_encryption_key,
    derive_lookup_id,
)
from keygrain.totp import derive_totp_seed, generate_totp
from keygrain.wallet import derive_wallet_entropy, entropy_to_mnemonic

ROOT = Path(__file__).resolve().parent.parent

def load(name):
    return json.loads((ROOT / name).read_text())

def hex_bytes(value):
    return bytes.fromhex(value)

def main():
    totp = load("totp-vectors.json")
    ssh = load("ssh-vectors.json")
    wallet = load("wallet-vectors.json")
    sync = load("sync-vectors.json")
    out = {"totp_rfc": [], "totp_derived": [], "ssh": [], "wallet": [], "sync": {}}

    seeds = totp["rfc6238_vectors"]["seeds"]
    for index, vector in enumerate(totp["rfc6238_vectors"]["vectors"]):
        code = generate_totp(
            hex_bytes(seeds[vector["algorithm"]]),
            vector["time"],
            digits=8,
            period=30,
            algorithm=vector["algorithm"],
        )
        out["totp_rfc"].append({"index": index, "code": code})

    for index, vector in enumerate(totp["derivation_vectors"]["vectors"]):
        seed = derive_totp_seed(
            vector["secret_utf8"].encode(), vector["email"], vector["site"]
        )
        out["totp_derived"].append({"index": index, "seed_hex": seed.hex()})

    for index, vector in enumerate(ssh["derivation_vectors"]["vectors"]):
        seed, public_key = derive_ssh_keypair(
            vector["secret_utf8"].encode(),
            vector["email"],
            key_name=vector["key_name"],
            counter=vector["counter"],
        )
        comment = f'{vector["email"].lower()}:{vector["key_name"].lower()}'
        out["ssh"].append({
            "index": index,
            "seed_hex": seed.hex(),
            "public_key_hex": public_key.hex(),
            "authorized_keys": format_authorized_keys(public_key, comment),
        })

    for vector in wallet["derivation_vectors"]:
        entropy = derive_wallet_entropy(
            vector["secret"].encode(),
            vector["email"],
            wallet_name=vector["wallet_name"],
            chain=vector["chain"],
            counter=vector["counter"],
        )
        out["wallet"].append({
            "id": vector["id"],
            "entropy_hex": entropy.hex(),
            "mnemonic": entropy_to_mnemonic(entropy),
        })

    out["sync"]["lookup_id"] = derive_lookup_id(sync["secret"].encode(), sync["email"])
    out["sync"]["auth_password"] = derive_auth_password(sync["secret"].encode(), sync["email"])
    out["sync"]["encryption_key_hex"] = derive_encryption_key(
        sync["secret"].encode(), sync["email"]
    ).hex()
    out["sync"]["services"] = []
    for index, service in enumerate(sync["services"]):
        item = {"index": index}
        if "length" in service:
            from keygrain.derive import derive_password
            item["password"] = derive_password(
                sync["secret"].encode(),
                service["email"],
                site=service["site"],
                length=service["length"],
                symbols=service["symbols"],
                counter=service["counter"],
            )
        elif "totp" in service:
            item["totp_seed_hex"] = derive_totp_seed(
                sync["secret"].encode(), service["email"], service["site"]
            ).hex()
        elif "ssh" in service:
            _, public_key = derive_ssh_keypair(
                sync["secret"].encode(),
                service["email"],
                key_name=service["ssh"]["key_name"],
                counter=service["ssh"]["counter"],
            )
            comment = f'{service["email"].lower()}:{service["ssh"]["key_name"].lower()}'
            item["ssh_authorized_keys"] = format_authorized_keys(public_key, comment)
        else:
            raise ValueError(f"Unsupported sync service shape at index {index}")
        out["sync"]["services"].append(item)

    print(json.dumps(out, separators=(",", ":")))

if __name__ == "__main__":
    main()
