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
    if length > 128:
        raise ValueError("Error: Password length must not exceed 128.")
    if not symbols:
        raise ValueError("Error: At least one symbol character is required.")
    if not email or not email.strip():
        raise ValueError("Error: Email must not be empty.")
    if len(UPPER) + len(LOWER) + len(DIGITS) + len(symbols) > 256:
        raise ValueError("Error: Total charset size must not exceed 256.")

    email = email.lower()
    site = normalize_site(site)
    if not site:
        raise ValueError("Error: Site must not be empty.")
    effective_secret = strengthen_secret(secret, email)
    full_charset = UPPER + LOWER + DIGITS + symbols

    message = f"{site}:{email}:{length}:{counter}".encode()
    key = hmac.new(effective_secret, message, hashlib.sha256).digest()
    stream = bytearray(key)
    ctr = 1
    pos = 0

    def next_byte() -> int:
        nonlocal pos, stream, ctr
        if pos >= len(stream):
            stream += hmac.new(key, ctr.to_bytes(4, "big"), hashlib.sha256).digest()
            ctr += 1
        b = stream[pos]
        pos += 1
        return b

    def unbiased_index(n: int) -> int:
        limit = (256 // n) * n
        while True:
            b = next_byte()
            if b < limit:
                return b % n

    # Step 1: Force one char from each category
    chars = [
        UPPER[unbiased_index(len(UPPER))],
        LOWER[unbiased_index(len(LOWER))],
        DIGITS[unbiased_index(len(DIGITS))],
        symbols[unbiased_index(len(symbols))],
    ]

    # Step 2: Fill remaining
    for _ in range(length - 4):
        chars.append(full_charset[unbiased_index(len(full_charset))])

    # Step 3: Fisher-Yates shuffle
    for i in range(length - 1, 0, -1):
        j = unbiased_index(i + 1)
        chars[i], chars[j] = chars[j], chars[i]

    return "".join(chars)
