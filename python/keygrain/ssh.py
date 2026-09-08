"""Deterministic Ed25519 SSH key derivation. See the public SSH-key documentation."""

import base64
import hashlib
import hmac
import re
import struct

from argon2.low_level import hash_secret_raw, Type
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

_ssh_strengthen_cache: dict[tuple[bytes, str], bytes] = {}


def _strengthen_ssh(secret: bytes, key_name: str) -> bytes:
    key_name_lower = key_name.lower()
    cache_key = (secret, key_name_lower)
    if cache_key not in _ssh_strengthen_cache:
        salt = f"keygrain-ssh:{key_name_lower}".encode("utf-8")
        _ssh_strengthen_cache[cache_key] = hash_secret_raw(
            secret=secret,
            salt=salt,
            time_cost=3,
            memory_cost=65536,
            parallelism=1,
            hash_len=32,
            type=Type.ID,
        )
    return _ssh_strengthen_cache[cache_key]


def derive_ssh_keypair(
    secret: bytes,
    *,
    key_name: str,
    counter: int = 1,
) -> tuple[bytes, bytes]:
    """Derive an Ed25519 keypair deterministically.

    Returns:
        Tuple of (seed: 32 bytes, public_key: 32 bytes).
    """
    if not secret:
        raise ValueError("secret must not be empty")
    if not key_name:
        raise ValueError("key_name must not be empty")
    if re.search(r"\s", key_name):
        raise ValueError("key_name must not contain whitespace")
    if counter < 1:
        raise ValueError("counter must be >= 1")

    key_name_clean = key_name.lower()
    strengthened = _strengthen_ssh(secret, key_name_clean)
    message = f"{key_name_clean}:{counter}:keygrain-ssh".encode("utf-8")
    seed = hmac.new(strengthened, message, hashlib.sha256).digest()

    private_key = Ed25519PrivateKey.from_private_bytes(seed)
    public_key = private_key.public_key().public_bytes_raw()

    return (seed, public_key)


def format_openssh_private_key(seed: bytes, public_key: bytes, comment: str) -> str:
    """Format an Ed25519 keypair as an OpenSSH PEM private key string."""
    if re.search(r"[\x00-\x1f\x7f]", comment):
        raise ValueError("comment must not contain control characters")
    # Deterministic check bytes
    check_bytes = hmac.new(seed, b"openssh-check", hashlib.sha256).digest()
    check_int = struct.unpack(">I", check_bytes[0:4])[0]

    # Public key blob: string "ssh-ed25519" + string public_key_raw
    pub_blob = _string(b"ssh-ed25519") + _string(public_key)

    # Private key blob (unencrypted)
    priv_section = b""
    priv_section += struct.pack(">I", check_int)
    priv_section += struct.pack(">I", check_int)
    priv_section += _string(b"ssh-ed25519")
    priv_section += _string(public_key)
    priv_section += _string(seed + public_key)  # 64 bytes: seed || pubkey
    priv_section += _string(comment.encode("utf-8"))

    # Padding: bytes 1, 2, 3, ..., N (block size 8)
    pad_len = (8 - len(priv_section) % 8) % 8
    priv_section += bytes(range(1, pad_len + 1))

    # Outer structure
    blob = b""
    blob += b"openssh-key-v1\x00"
    blob += _string(b"none")       # ciphername
    blob += _string(b"none")       # kdfname
    blob += _string(b"")           # kdfoptions
    blob += struct.pack(">I", 1)   # number of keys
    blob += _string(pub_blob)
    blob += _string(priv_section)

    # Base64 encode with 70-char lines
    b64 = base64.b64encode(blob).decode("ascii")
    lines = [b64[i:i+70] for i in range(0, len(b64), 70)]

    return "-----BEGIN OPENSSH PRIVATE KEY-----\n" + "\n".join(lines) + "\n-----END OPENSSH PRIVATE KEY-----\n"


def format_authorized_keys(public_key: bytes, comment: str) -> str:
    """Format an Ed25519 public key as an authorized_keys line."""
    if re.search(r"[\x00-\x1f\x7f]", comment):
        raise ValueError("comment must not contain control characters")
    pub_blob = _string(b"ssh-ed25519") + _string(public_key)
    b64 = base64.b64encode(pub_blob).decode("ascii")
    return f"ssh-ed25519 {b64} {comment}"


def _string(data: bytes) -> bytes:
    """Encode as SSH string: uint32 length + data."""
    return struct.pack(">I", len(data)) + data
