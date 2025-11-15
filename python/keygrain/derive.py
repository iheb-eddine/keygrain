"""Deterministic password derivation. See SPEC.md for algorithm details."""

import hashlib
import hmac

UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
LOWER = "abcdefghjkmnpqrstuvwxyz"
DIGITS = "23456789"
DEFAULT_SYMBOLS = "!@#$%&*-_=+?"


def _stream(secret: bytes, email: str, length: int, salt: str) -> bytes:
    """Generate pseudorandom byte stream via HMAC-SHA256."""
    message = f"{email}:{length}:{salt}".encode()
    key = hmac.new(secret, message, hashlib.sha256).digest()
    stream = key
    counter = 1
    # Extend until we have enough bytes (length * 2 is generous)
    while len(stream) < length * 2:
        stream += hmac.new(key, counter.to_bytes(1, "big"), hashlib.sha256).digest()
        counter += 1
    return stream


def derive_password(
    secret: bytes,
    email: str,
    *,
    length: int = 20,
    symbols: str = DEFAULT_SYMBOLS,
    salt: str = "",
) -> str:
    """Derive a deterministic password from secret + email.

    Args:
        secret: Master secret bytes.
        email: Email address (lowercased internally).
        length: Password length (minimum 8).
        symbols: Symbol charset to use.
        salt: Optional salt for uniqueness.

    Returns:
        Password string guaranteed to contain upper, lower, digit, and symbol.
    """
    if length < 8:
        raise ValueError("length must be >= 8")
    if not symbols:
        raise ValueError("symbols must not be empty")

    email = email.lower()
    full_charset = UPPER + LOWER + DIGITS + symbols

    stream = _stream(secret, email, length, salt)
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
