"""TOTP generation, parsing, and derivation. See designs/totp-derivation.md."""

import base64
import hashlib
import hmac
import re
import struct
from urllib.parse import unquote, urlparse, parse_qs

from .derive import strengthen_secret

_HEX_FORCING_CHARS = set("0189abcdef")


def generate_totp(
    seed: bytes,
    time: int,
    *,
    digits: int = 6,
    period: int = 30,
    algorithm: str = "SHA1",
) -> str:
    """Generate an RFC 6238 TOTP code. Returns zero-padded string."""
    algo_map = {"SHA1": "sha1", "SHA256": "sha256", "SHA512": "sha512"}
    hash_name = algo_map.get(algorithm.upper())
    if hash_name is None:
        raise ValueError(f"Unsupported algorithm: {algorithm}")
    if digits not in (6, 8):
        raise ValueError(f"digits must be 6 or 8, got {digits}")
    if period < 1:
        raise ValueError(f"period must be >= 1, got {period}")

    t = time // period
    t_bytes = struct.pack(">Q", t)
    hmac_result = hmac.new(seed, t_bytes, hash_name).digest()
    offset = hmac_result[-1] & 0x0F
    code = (
        (hmac_result[offset] & 0x7F) << 24
        | (hmac_result[offset + 1] & 0xFF) << 16
        | (hmac_result[offset + 2] & 0xFF) << 8
        | (hmac_result[offset + 3] & 0xFF)
    )
    otp = code % (10**digits)
    return str(otp).zfill(digits)


def parse_totp_input(input_str: str) -> dict:
    """Parse otpauth:// URI, base32, or hex into TOTP parameters.

    Returns: {"seed": bytes, "digits": int, "period": int, "algorithm": str,
              "issuer": str|None, "label": str|None}
    Raises: ValueError on invalid input.
    """
    input_str = input_str.strip()
    if not input_str:
        raise ValueError("Empty input")

    # Priority 1: otpauth:// URI
    if input_str.startswith("otpauth://"):
        return _parse_otpauth(input_str)

    # Priority 2: Hex (valid hex, length >= 20, contains char that forces hex)
    # Per design: 0, 1, 8, 9, lowercase a-f force hex interpretation
    if len(input_str) >= 20 and _is_valid_hex(input_str):
        if any(c in _HEX_FORCING_CHARS for c in input_str):
            seed = bytes.fromhex(input_str)
            return {"seed": seed, "digits": 6, "period": 30, "algorithm": "SHA1",
                    "issuer": None, "label": None}

    # Priority 3: Base32
    cleaned = re.sub(r"[\s\-=]", "", input_str).upper()
    base32_alpha = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
    if cleaned and all(c in base32_alpha for c in cleaned):
        # Pad to multiple of 8
        padding = (8 - len(cleaned) % 8) % 8
        padded = cleaned + "=" * padding
        try:
            seed = base64.b32decode(padded)
            return {"seed": seed, "digits": 6, "period": 30, "algorithm": "SHA1",
                    "issuer": None, "label": None}
        except Exception:
            pass

    raise ValueError(f"Cannot parse TOTP input: {input_str!r}")


def derive_totp_seed(secret: bytes, email: str, site: str) -> bytes:
    """Derive a 32-byte TOTP seed deterministically (Model B)."""
    from .derive import normalize_site
    strengthened = strengthen_secret(secret, email)
    normalized = normalize_site(site)
    message = (normalized + ":" + email.lower() + ":keygrain-totp").encode("utf-8")
    return hmac.new(strengthened, message, hashlib.sha256).digest()


def _parse_otpauth(uri: str) -> dict:
    parsed = urlparse(uri)
    if parsed.scheme != "otpauth":
        raise ValueError("Not an otpauth URI")
    if parsed.hostname != "totp":
        raise ValueError("Only TOTP is supported (not HOTP)")

    params = parse_qs(parsed.query)
    secret_list = params.get("secret")
    if not secret_list or not secret_list[0]:
        raise ValueError("Missing secret parameter")

    secret_b32 = re.sub(r"[\s\-=]", "", secret_list[0]).upper()
    if not all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" for c in secret_b32):
        raise ValueError("Invalid base32 in secret parameter")
    padding = (8 - len(secret_b32) % 8) % 8
    seed = base64.b32decode(secret_b32 + "=" * padding)

    algo = params.get("algorithm", ["SHA1"])[0].upper()
    if algo not in ("SHA1", "SHA256", "SHA512"):
        raise ValueError(f"Unsupported algorithm: {algo}")

    digits = int(params.get("digits", ["6"])[0])
    if digits not in (6, 8):
        raise ValueError(f"digits must be 6 or 8, got {digits}")

    period = int(params.get("period", ["30"])[0])
    if period < 1 or period > 300:
        raise ValueError(f"period must be 1-300, got {period}")

    issuer = params.get("issuer", [None])[0]
    label = unquote(parsed.path.lstrip("/")) if parsed.path else None

    return {"seed": seed, "digits": digits, "period": period, "algorithm": algo,
            "issuer": issuer, "label": label}


def _is_valid_hex(s: str) -> bool:
    try:
        int(s, 16)
        return len(s) % 2 == 0
    except ValueError:
        return False
