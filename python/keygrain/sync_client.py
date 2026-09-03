"""Read-only sync client: derivations, server blob decryption, and GET.

Reproduces the extension's sync crypto **bit-for-bit** (see
``extension/shared/keygrain.js`` and ``sync.js``, and ``API.md``):

- ``lookup_id``      = hex(HMAC-SHA256(strengthened, email.lower()+":keygrain-id"))
- ``auth_password``  = buildPassword(buildStream(strengthened, email.lower()+":32:keygrain-auth", 256), 32, DEFAULT_SYMBOLS)
- ``encryption_key`` = HMAC-SHA256(strengthened, email.lower()+":keygrain-encryption")
- server blob        = base64(iv[12] || ciphertext || tag[16]), AES-256-GCM, AAD = lookup_id

``auth_password`` is intentionally NOT ``derive_password`` — the message shape
differs (``email:32:keygrain-auth`` vs ``site:email:length:counter``). The
password-building primitives are reimplemented here so that ``derive.py`` (the
checksum-relevant core) stays untouched; ``test_sync_client`` pins these
primitives to the vector-verified ``derive_password`` output.

This module is **read-only**: it contains a GET code path only. There is no
PUT/POST/DELETE anywhere.
"""

import base64
import hashlib
import hmac
import json
import re
from enum import Enum
import urllib.error
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag

from .derive import strengthen_secret, UPPER, LOWER, DIGITS, DEFAULT_SYMBOLS


# --- Exception hierarchy (network members raised in the GET path, added below) ---

class SyncError(Exception):
    """Base class for all sync client errors."""


class AuthError(SyncError):
    """Server returned 401 (wrong secret/email)."""


class NotFoundError(SyncError):
    """Server returned 404 (no record for this account)."""


class RateLimitedError(SyncError):
    """Server returned 429. ``retry_after`` holds the suggested seconds."""

    def __init__(self, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class ChecksumMismatchError(SyncError):
    """The blob's SHA-256 did not match the server-provided checksum."""


class BlobDecryptError(SyncError):
    """AES-GCM authentication failed (wrong secret, tampering, or legacy record)."""


class NetworkError(SyncError):
    """Transport-level failure reaching the server."""


class ServerError(SyncError):
    """Server returned an unexpected (non-2xx, non-mapped) status."""


class CapabilityMetadataClassification(str, Enum):
    """Classification of the optional server capability envelope."""

    LEGACY_ABSENT = "legacy_absent"
    STRICT = "strict"
    PARTIAL = "partial"
    MALFORMED = "malformed"
    CONTRADICTORY = "contradictory"
    UNSUPPORTED = "unsupported"


class UpgradeRequired(SyncError):
    """The server response requires a newer client and must not be retried."""

    def __init__(self, reason: str | CapabilityMetadataClassification | None = None):
        self.reason = reason
        # Keep exception text generic; CLI callers use fixed safe upgrade copy.
        super().__init__("Upgrade required.")


_CAPABILITY_FIELDS = ("payload_version", "min_writer_protocol", "capabilities")
_STRICT_CAPABILITY = "account_defaults_immutable_v1"
_DEFAULTS_FIELDS = frozenset(("schema", "length", "symbols", "policy"))
_DEFAULTS_SCHEMA = 1
_DEFAULTS_MIN_LENGTH = 8
_DEFAULTS_MAX_LENGTH = 128
_DEFAULTS_POLICY = "ascii-printable-v1"
_DEFAULTS_MAX_CHARSET = 256
_DEFAULTS_PRINTABLE_ASCII = range(0x21, 0x7F)
_NORMALIZED_EMAIL_RE = re.compile(
    r"^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$"
)
_DEFAULTS_COMMITMENT_DOMAIN = b"keygrain-account-defaults-v1\x00"
_DEFAULTS_COMMITMENT_SUFFIX = ":keygrain-defaults-commitment"
_V3_AAD_DOMAIN = b"keygrain-sync-v3\x00"
_LOOKUP_ID_RE = re.compile(r"^[0-9a-f]{64}$")
_LOWERCASE_HEX_64_RE = re.compile(r"^[0-9a-f]{64}$")


def _validate_account_defaults(defaults: dict) -> None:
    """Validate the exact semantic account-defaults mapping without coercion."""
    if type(defaults) is not dict or set(defaults) != _DEFAULTS_FIELDS:
        raise TypeError("defaults must be a plain object with exactly four fields")

    schema = defaults["schema"]
    length = defaults["length"]
    symbols = defaults["symbols"]
    policy = defaults["policy"]
    if type(schema) is not int or schema != _DEFAULTS_SCHEMA:
        raise ValueError("unsupported defaults schema")
    if type(length) is not int or not _DEFAULTS_MIN_LENGTH <= length <= _DEFAULTS_MAX_LENGTH:
        raise ValueError("defaults length is invalid")
    if type(policy) is not str or policy != _DEFAULTS_POLICY:
        raise ValueError("defaults policy is invalid")
    if type(symbols) is not str or not symbols or any(
        ord(character) not in _DEFAULTS_PRINTABLE_ASCII for character in symbols
    ):
        raise ValueError("defaults symbols are invalid")
    if len(UPPER) + len(LOWER) + len(DIGITS) + len(symbols) > _DEFAULTS_MAX_CHARSET:
        raise ValueError("defaults charset is too large")


def canonical_account_defaults_json(defaults: dict) -> str:
    """Return the compact, sorted canonical JSON for account defaults.

    Only the four semantic fields are accepted, in the exact field order used
    by the extension and Android implementations. The input is not mutated.
    """
    _validate_account_defaults(defaults)
    canonical = {
        "length": defaults["length"],
        "policy": defaults["policy"],
        "schema": defaults["schema"],
        "symbols": defaults["symbols"],
    }
    return json.dumps(canonical, ensure_ascii=False, separators=(",", ":"))


def derive_defaults_commitment(
    strengthened: bytes | bytearray | memoryview,
    normalized_email: str,
    defaults: dict,
) -> str:
    """Derive the lowercase hex commitment for immutable account defaults."""
    try:
        strengthened_view = memoryview(strengthened)
    except TypeError as exc:
        raise TypeError("strengthened key must be exactly 32 bytes") from exc
    if strengthened_view.nbytes != 32:
        raise ValueError("strengthened key must be exactly 32 bytes")
    if not isinstance(normalized_email, str):
        raise TypeError("normalized email is invalid")
    try:
        email_bytes = normalized_email.encode("ascii")
    except UnicodeEncodeError as exc:
        raise ValueError("normalized email is invalid") from exc
    if not 1 <= len(email_bytes) <= 254 or _NORMALIZED_EMAIL_RE.fullmatch(normalized_email) is None:
        raise ValueError("normalized email is invalid")

    canonical = canonical_account_defaults_json(defaults).encode("utf-8")
    strengthened_copy = bytes(strengthened_view)
    commit_key = hmac.new(
        strengthened_copy,
        email_bytes + _DEFAULTS_COMMITMENT_SUFFIX.encode("ascii"),
        hashlib.sha256,
    ).digest()
    commitment = hmac.new(
        commit_key,
        _DEFAULTS_COMMITMENT_DOMAIN + canonical,
        hashlib.sha256,
    ).hexdigest()
    return commitment


def build_v3_sync_aad(
    lookup_id: str,
    defaults_state: str,
    commitment: str | None = None,
) -> bytes:
    """Build the exact UTF-8 AAD envelope for a v3 sync blob."""
    if not isinstance(lookup_id, str) or _LOOKUP_ID_RE.fullmatch(lookup_id) is None:
        raise TypeError("lookup id is invalid")
    if defaults_state not in {"UNSEALED", "ABSENT", "PRESENT"}:
        raise TypeError("defaults state is invalid")
    if defaults_state == "PRESENT":
        if not isinstance(commitment, str) or _LOWERCASE_HEX_64_RE.fullmatch(commitment) is None:
            raise TypeError("present defaults commitment is invalid")
    elif commitment is not None:
        raise TypeError("unsealed or absent defaults must not have a commitment")
    return (
        _V3_AAD_DOMAIN
        + lookup_id.encode("ascii")
        + b"\x00"
        + defaults_state.encode("ascii")
        + b"\x00"
        + (commitment or "").encode("ascii")
    )


def classify_capability_metadata(payload) -> CapabilityMetadataClassification:
    """Classify the optional three-field server capability envelope.

    Presence is checked separately from value validity. This ensures that null,
    floating-point, boolean, string, non-array, or mixed-element values are
    malformed rather than being mistaken for an absent or partial envelope.
    """
    if not isinstance(payload, dict):
        return CapabilityMetadataClassification.MALFORMED
    if not any(key in payload for key in _CAPABILITY_FIELDS):
        return CapabilityMetadataClassification.LEGACY_ABSENT

    payload_version = payload.get("payload_version")
    min_writer_protocol = payload.get("min_writer_protocol")
    capabilities = payload.get("capabilities")

    def valid_protocol(value, key):
        return key not in payload or (isinstance(value, int) and not isinstance(value, bool))

    valid_capabilities = (
        "capabilities" not in payload
        or isinstance(capabilities, list)
        and all(isinstance(item, str) for item in capabilities)
    )
    if (
        not valid_protocol(payload_version, "payload_version")
        or not valid_protocol(min_writer_protocol, "min_writer_protocol")
        or not valid_capabilities
    ):
        return CapabilityMetadataClassification.MALFORMED

    if any(key not in payload for key in _CAPABILITY_FIELDS):
        return CapabilityMetadataClassification.PARTIAL

    strict = (
        payload_version == 3
        and min_writer_protocol == 3
        and capabilities == [_STRICT_CAPABILITY]
    )
    if strict:
        return CapabilityMetadataClassification.STRICT
    if min_writer_protocol == 3:
        return CapabilityMetadataClassification.CONTRADICTORY
    return CapabilityMetadataClassification.UNSUPPORTED


# --- Bit-for-bit password/stream primitives (mirror keygrain.js) ---

def _build_stream(key: bytes, message: bytes, needed: int) -> bytes:
    """Mirror keygrain.js buildStream: HMAC-SHA256 chained with a 4-byte BE counter."""
    hmac_key = hmac.new(key, message, hashlib.sha256).digest()
    stream = bytearray(hmac_key)
    counter = 1
    while len(stream) < needed:
        stream += hmac.new(hmac_key, counter.to_bytes(4, "big"), hashlib.sha256).digest()
        counter += 1
    return bytes(stream)


def _build_password(stream: bytes, length: int, symbols: str) -> str:
    """Mirror keygrain.js buildPassword: rejection sampling + Fisher-Yates shuffle."""
    full_charset = UPPER + LOWER + DIGITS + symbols
    pos = 0

    def next_byte() -> int:
        nonlocal pos
        if pos >= len(stream):
            raise ValueError("stream exhausted")
        b = stream[pos]
        pos += 1
        return b

    def unbiased_index(n: int) -> int:
        limit = (256 // n) * n
        while True:
            b = next_byte()
            if b < limit:
                return b % n

    chars = [
        UPPER[unbiased_index(len(UPPER))],
        LOWER[unbiased_index(len(LOWER))],
        DIGITS[unbiased_index(len(DIGITS))],
        symbols[unbiased_index(len(symbols))],
    ]
    for _ in range(length - 4):
        chars.append(full_charset[unbiased_index(len(full_charset))])
    for i in range(length - 1, 0, -1):
        j = unbiased_index(i + 1)
        chars[i], chars[j] = chars[j], chars[i]
    return "".join(chars)


# --- Sync credential derivations ---

def derive_lookup_id(secret: bytes, email: str) -> str:
    """hex(HMAC-SHA256(strengthen(secret,email), email.lower()+":keygrain-id"))."""
    strengthened = strengthen_secret(secret, email)
    message = (email.lower() + ":keygrain-id").encode("utf-8")
    return hmac.new(strengthened, message, hashlib.sha256).hexdigest()


def derive_auth_password(secret: bytes, email: str) -> str:
    """The 32-char HTTP Basic password (message email.lower()+':32:keygrain-auth')."""
    strengthened = strengthen_secret(secret, email)
    message = (email.lower() + ":32:keygrain-auth").encode("utf-8")
    stream = _build_stream(strengthened, message, 256)
    return _build_password(stream, 32, DEFAULT_SYMBOLS)


def derive_encryption_key(secret: bytes, email: str) -> bytes:
    """HMAC-SHA256(strengthen(secret,email), email.lower()+":keygrain-encryption") (32 bytes)."""
    strengthened = strengthen_secret(secret, email)
    message = (email.lower() + ":keygrain-encryption").encode("utf-8")
    return hmac.new(strengthened, message, hashlib.sha256).digest()


# --- Server blob handling ---

def decrypt_server_blob(
    encryption_key: bytes, encrypted_blob_b64: str, lookup_id: str, expected_checksum: str
) -> bytes:
    """Validate checksum then AES-256-GCM decrypt a server blob.

    Blob layout: base64(iv[12] || ciphertext || tag[16]). AAD = lookup_id bytes.
    The checksum is SHA-256 of the DECODED (raw) blob bytes, hex-encoded.

    Raises:
        ChecksumMismatchError: decoded-blob SHA-256 != expected_checksum.
        BlobDecryptError: GCM auth failed (wrong secret, tampering, or a legacy
            pre-AAD record — v2/AAD-only is the accepted CLI limitation).
    """
    try:
        decoded = base64.b64decode(encrypted_blob_b64, validate=True)
    except (ValueError, TypeError) as exc:
        raise BlobDecryptError(f"Invalid blob encoding: {exc}") from exc

    actual_checksum = hashlib.sha256(decoded).hexdigest()
    if actual_checksum != expected_checksum:
        raise ChecksumMismatchError(
            "Blob checksum mismatch (transport corruption or tampering); aborting."
        )
    if len(decoded) < 12 + 16:
        raise BlobDecryptError("Blob too short to contain IV and GCM tag.")

    iv = decoded[:12]
    ct_and_tag = decoded[12:]
    aad = lookup_id.encode("utf-8")
    try:
        return AESGCM(encryption_key).decrypt(iv, ct_and_tag, aad)
    except InvalidTag as exc:
        raise BlobDecryptError(
            "Failed to decrypt server data: wrong secret, tampered record, or an "
            "unsupported legacy (pre-AAD) record."
        ) from exc


def parse_blob_content(plaintext: bytes) -> dict:
    """Parse decrypted blob JSON into {services, wallets, wallet_audit_log, sync_conflicts}.

    Accepts both the new object form and the legacy flat-array (services-only) form,
    matching sync.js:parseBlobContent.
    """
    parsed = json.loads(plaintext.decode("utf-8"))
    if isinstance(parsed, list):
        return {"services": parsed, "wallets": [], "wallet_audit_log": [], "sync_conflicts": []}
    return {
        "services": parsed.get("services", []),
        "wallets": parsed.get("wallets", []),
        "wallet_audit_log": parsed.get("wallet_audit_log", []),
        "sync_conflicts": parsed.get("sync_conflicts", []),
    }


# --- Read-only network layer (GET only; NO PUT/POST/DELETE code path exists) ---

DEFAULT_SERVER_URL = "https://keygrain.com"
DEFAULT_TIMEOUT = 30
# Defensive cap on response size. The server limits records to ~1MB / 1000
# services; a compromised/hostile endpoint could otherwise return an unbounded
# body. This does not affect crypto parity with the extension.
MAX_RESPONSE_BYTES = 8 * 1024 * 1024


def validate_server_url(server_url: str) -> None:
    """Reject cleartext sync endpoints except explicitly local development hosts."""
    try:
        parsed = urllib.parse.urlsplit(server_url)
        # Accessing .port is lazy and raises ValueError for malformed or out-of-range ports.
        parsed.port
        host = (parsed.hostname or "").lower().rstrip(".")
    except ValueError as exc:
        raise ServerError("Invalid sync server URL.") from exc

    is_loopback = host in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme == "https" and host:
        return
    if parsed.scheme == "http" and is_loopback:
        return
    raise ServerError(
        "Sync server URL must use HTTPS; HTTP is allowed only for localhost/loopback development."
    )


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Block ALL HTTP redirects instead of following them.

    ``urllib``'s default opener follows 3xx responses. On Python < 3.11.4 the
    ``Authorization: Basic <lookup_id:auth_password>`` header is **re-sent to the
    redirect target**, which — for a cross-host 3xx from a compromised or hostile
    endpoint — leaks the account's HTTP Basic credentials (full read access to the
    synced record). ``pyproject`` targets 3.10+, so we cannot rely on the 3.11.4+
    strip.

    ``redirect_request`` is the single funnel invoked by every ``http_error_3xx``
    handler (301/302/303/307/308). Raising here — *before* any Request to the new
    location is constructed or sent — means no second request can ever carry the
    Authorization header to another host. The raised ``HTTPError`` surfaces as a
    clear ``ServerError`` in ``_http_get``.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        raise urllib.error.HTTPError(
            req.full_url,
            code,
            f"Redirect blocked (server tried to redirect to {newurl!r}); "
            "refusing to follow to protect the Authorization header.",
            headers,
            fp,
        )


# Module-level opener with the no-redirect handler. ``build_opener`` replaces the
# default ``HTTPRedirectHandler`` because ``_NoRedirectHandler`` subclasses it
# (handlers are de-duplicated by their default-class ancestry).
_OPENER = urllib.request.build_opener(_NoRedirectHandler)


def _urlopen(request, timeout):
    """Single patchable indirection for the read-only GET (redirects blocked).

    Routes through ``_OPENER`` (which raises on any 3xx). Tests monkeypatch this
    function. This is the ONLY network call in the module — there is no write path.
    """
    return _OPENER.open(request, timeout=timeout)


def _http_get(url: str, lookup_id: str, auth_password: str, timeout: int):
    """Perform an authenticated HTTP GET. Returns (headers, body_bytes).

    Maps server statuses to the sync exception hierarchy. Redirects are blocked
    (see ``_NoRedirectHandler``) and surface as ``ServerError``.
    """
    token = base64.b64encode(f"{lookup_id}:{auth_password}".encode("utf-8")).decode("ascii")
    request = urllib.request.Request(
        url, method="GET", headers={"Authorization": "Basic " + token}
    )
    try:
        with _urlopen(request, timeout=timeout) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise ServerError("Server response too large; aborting.")
            return response.headers, body
    except urllib.error.HTTPError as exc:
        if exc.code in (301, 302, 303, 307, 308):
            raise ServerError(
                f"Server attempted an HTTP {exc.code} redirect; refusing to follow "
                "(protects the Authorization header from being sent to another host)."
            ) from exc
        if exc.code == 426:
            raise UpgradeRequired("http_426") from exc
        if exc.code == 401:
            raise AuthError("Authentication failed (check secret/email).") from exc
        if exc.code == 404:
            raise NotFoundError("No data on server for this account.") from exc
        if exc.code == 429:
            retry_after = None
            try:
                retry_after = int(exc.headers.get("Retry-After", "").strip())
            except (ValueError, AttributeError):
                retry_after = None
            hint = f" Retry after {retry_after}s." if retry_after else ""
            raise RateLimitedError(
                f"Rate limited by server.{hint}", retry_after=retry_after
            ) from exc
        raise ServerError(f"Server returned HTTP {exc.code}.") from exc
    except urllib.error.URLError as exc:
        raise NetworkError(f"Network error reaching server: {exc.reason}") from exc


# --- Unauthenticated-metadata sanitization (choke point: download_sync_content) ---

# Control-char filter matching ssh.py (\x00-\x1f\x7f) — anything that could inject
# terminal escape sequences into stdout/stderr.
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
# Permissive UUID shape (8-4-4-4-12 hex, case-insensitive) — NOT strict RFC-4122
# version/variant nibbles, so legitimate server ids are never silently dropped.
_UUID_RE = re.compile(
    r"\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z"
)


def _strip_control(value: str) -> str:
    """Remove control chars (\\x00-\\x1f\\x7f) — mirrors the ssh.py comment filter."""
    return _CONTROL_CHARS.sub("", value)


def _sanitize_metadata_element(meta) -> tuple:
    """Sanitize ONE unauthenticated top-level metadata element.

    The blob checksum + AES-GCM AAD only authenticate the encrypted blob (which
    carries name/site/email/params). The top-level ``services`` metadata array
    (``id`` + ``updated_at``) is attacker-controlled by a hostile/compromised
    server and, of its fields, ``id`` is the one that reaches stdout/stderr
    (printed by ``list``/``get`` and in ambiguity candidate lists).

    Returns ``(clean_id, clean_updated_at)``:
    - Non-dict element -> ``(None, None)`` (no ``AttributeError`` crash).
    - ``updated_at`` coerced to ``int`` when it is an int / bool-free numeric /
      digit string, else ``None`` (so it can never carry an escape sequence).
    - ``id`` must be a string that, after control-char stripping, matches the
      permissive UUID shape; otherwise it is dropped to ``None``. This guarantees
      no control chars (and nothing non-UUID) can be printed as an id.
    """
    if not isinstance(meta, dict):
        return None, None

    # updated_at -> int | None
    raw_ts = meta.get("updated_at")
    clean_ts: int | None
    if isinstance(raw_ts, bool):  # bool is a subclass of int; reject it explicitly
        clean_ts = None
    elif isinstance(raw_ts, int):
        clean_ts = raw_ts
    elif isinstance(raw_ts, float):
        clean_ts = int(raw_ts)
    elif isinstance(raw_ts, str) and raw_ts.strip().lstrip("-").isdigit():
        clean_ts = int(raw_ts.strip())
    else:
        clean_ts = None

    # id -> UUID-shaped string | None (control chars stripped first, defensively)
    raw_id = meta.get("id")
    clean_id: str | None = None
    if isinstance(raw_id, str):
        stripped = _strip_control(raw_id)
        if _UUID_RE.match(stripped):
            clean_id = stripped
    return clean_id, clean_ts


def download_sync_content(
    server_url: str, secret: bytes, email: str, *, timeout: int = DEFAULT_TIMEOUT
) -> dict:
    """Download, validate, and decrypt the account's sync record (read-only GET).

    Returns a content dict ``{services, wallets, wallet_audit_log, sync_conflicts}``
    where each service is enriched with ``id`` and ``updated_at`` taken from the
    server's top-level metadata array (aligned BY INDEX, matching the extension's
    merge). The encrypted blob itself does not carry id/updated_at.

    Raises:
        AuthError / NotFoundError / RateLimitedError / NetworkError / ServerError,
        ChecksumMismatchError, BlobDecryptError, or SyncError (malformed response
        or metadata/content length mismatch).
    """
    validate_server_url(server_url)
    lookup_id = derive_lookup_id(secret, email)
    auth_password = derive_auth_password(secret, email)
    encryption_key = derive_encryption_key(secret, email)

    url = server_url.rstrip("/") + "/api/sync/" + lookup_id
    _headers, body = _http_get(url, lookup_id, auth_password, timeout)

    try:
        payload = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise SyncError("Malformed server response (not valid JSON).") from exc

    capability_classification = classify_capability_metadata(payload)
    if capability_classification != CapabilityMetadataClassification.LEGACY_ABSENT:
        raise UpgradeRequired(capability_classification)

    if not isinstance(payload, dict) or "encrypted_blob" not in payload or "checksum" not in payload:
        raise SyncError("Malformed server response (missing fields).")

    metadata = payload.get("services") or []
    plaintext = decrypt_server_blob(
        encryption_key, payload["encrypted_blob"], lookup_id, payload["checksum"]
    )
    content = parse_blob_content(plaintext)

    services = content["services"]
    if len(metadata) != len(services):
        raise SyncError(
            "Server metadata/content length mismatch "
            f"({len(metadata)} vs {len(services)}); refusing to cache."
        )
    # Attach id + updated_at by index (blob content lacks them; extension zips
    # remoteServices[i] with remoteMetadata[i]). The metadata is UNAUTHENTICATED
    # (outside the blob checksum/AAD), so each element is sanitized here — the
    # single download choke point — before it can be cached or printed.
    for meta, svc in zip(metadata, services):
        if isinstance(svc, dict):
            clean_id, clean_ts = _sanitize_metadata_element(meta)
            svc["id"] = clean_id
            svc["updated_at"] = clean_ts
    return content
