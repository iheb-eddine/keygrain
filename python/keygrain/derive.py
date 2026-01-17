"""Deterministic password derivation. See SPEC.md for algorithm details."""

import hashlib
import hmac
import re

from argon2.low_level import hash_secret_raw, Type

UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
LOWER = "abcdefghjkmnpqrstuvwxyz"
DIGITS = "23456789"
DEFAULT_SYMBOLS = "!@#$%&*-_=+?"

def normalize_site(site: str) -> str:
    """Normalize a site identifier: strip protocol, www, path, lowercase."""
    site = re.sub(r'^https?://', '', site, flags=re.IGNORECASE)
    site = site.split('/')[0].split('?')[0].split('#')[0]
    site = site.rstrip('/').lower()
    site = re.sub(r'^www\.', '', site)
    return site


_strengthen_cache: dict[tuple[bytes, str], bytes] = {}


def strengthen_secret(secret: bytes, email: str) -> bytes:
    """Run Argon2id on the secret to produce a strengthened 32-byte key."""
    email = email.lower()
    key = (secret, email)
    if key not in _strengthen_cache:
        salt = ("keygrain-strengthen:" + email).encode("utf-8")
        _strengthen_cache[key] = hash_secret_raw(
            secret=secret,
            salt=salt,
            time_cost=3,
            memory_cost=65536,
            parallelism=1,
            hash_len=32,
            type=Type.ID,
        )
    return _strengthen_cache[key]


def clear_strengthen_cache() -> None:
    """Clear the internal Argon2id cache."""
    _strengthen_cache.clear()


def _stream(secret: bytes, message: bytes, length: int) -> bytes:
    """Generate pseudorandom byte stream via HMAC-SHA256."""
    key = hmac.new(secret, message, hashlib.sha256).digest()
    stream = key
    ctr = 1
    while len(stream) < length * 2:
        stream += hmac.new(key, ctr.to_bytes(1, "big"), hashlib.sha256).digest()
        ctr += 1
    return stream


def derive_password(
    secret: bytes,
    email: str,
    *,
    site: str,
    length: int = 20,
    symbols: str = DEFAULT_SYMBOLS,
    counter: int = 1,
) -> str:
    """Derive a deterministic password from secret + email + site.

    Args:
        secret: Master secret bytes.
        email: Email address (lowercased internally).
        site: Site identifier (lowercased internally).
        length: Password length (minimum 8).
        symbols: Symbol charset to use.
        counter: Rotation counter (default 1).

    Returns:
        Password string guaranteed to contain upper, lower, digit, and symbol.
    """
    if length < 8:
        raise ValueError("Error: Password length must be at least 8.")
    if not symbols:
        raise ValueError("Error: At least one symbol character is required.")
    if not site:
        raise ValueError("Error: Site must not be empty.")

    email = email.lower()
    site = site.lower()
    effective_secret = strengthen_secret(secret, email)
    full_charset = UPPER + LOWER + DIGITS + symbols

    message = f"{site}:{email}:{length}:{counter}".encode()
    stream = _stream(effective_secret, message, length)
    pos = 0

    def next_byte() -> int:
        nonlocal pos
        b = stream[pos]
        pos += 1
        return b

    # Step 2: Force one char from each category
    chars = [
        UPPER[next_byte() % len(UPPER)],
        LOWER[next_byte() % len(LOWER)],
        DIGITS[next_byte() % len(DIGITS)],
        symbols[next_byte() % len(symbols)],
    ]

    # Step 3: Fill remaining
    for _ in range(length - 4):
        chars.append(full_charset[next_byte() % len(full_charset)])

    # Step 4: Fisher-Yates shuffle
    for i in range(length - 1, 0, -1):
        j = next_byte() % (i + 1)
        chars[i], chars[j] = chars[j], chars[i]

    return "".join(chars)
