"""Local encrypted cache for the read-only CLI.

Layout (multi-account-ready from day one; v1 uses exactly one account file):

    ~/.keygrain/
    └── accounts/
        ├── <slug>.kg      # AES-256-GCM encrypted cache (0600)
        └── <slug>.lock    # presence => sync sealed off for this account

    slug = sha256(account_email.lower())[:16]  (hex, non-secret)

Cache envelope (JSON):

    {"format":"keygrain-cli-cache","version":1,
     "account_email":"<plaintext>","synced_at":<unix>,
     "kdf":{"type":"argon2id-strengthen","label":"keygrain-cli-cache"},
     "iv":"<b64 12>","ciphertext":"<b64 ct||tag>"}

- Encryption: AES-256-GCM.
- Key: HMAC-SHA256(strengthen(secret, account_email), account_email.lower()+":keygrain-cli-cache").
- AAD: account_email.lower() bytes — binds the plaintext header email to the
  ciphertext (editing the header email fails decryption loudly).
- ``server_url`` lives INSIDE the encrypted body (authenticated), never in the
  plaintext header — closes the credential-redirection hole.

The cache root is ``~/.keygrain``.
"""

import base64
import hashlib
import hmac
import json
import os
import tempfile
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag

from .derive import strengthen_secret

CACHE_FORMAT = "keygrain-cli-cache"
CACHE_VERSION = 1
CACHE_LABEL = "keygrain-cli-cache"


class CacheError(Exception):
    """Base class for cache errors."""


class CacheNotFoundError(CacheError):
    """No cache file exists for the account."""


class CacheDecryptError(CacheError):
    """Cache decryption failed (wrong secret or the file was modified)."""


class CacheFormatError(CacheError):
    """Cache file is present but malformed / unsupported."""


class AmbiguousAccountError(CacheError):
    """More than one account cache exists and none was specified."""


# --- Paths ---

def keygrain_home() -> str:
    """Return the cache root (``~/.keygrain``)."""
    return os.path.join(os.path.expanduser("~"), ".keygrain")


def accounts_dir(home: str | None = None) -> str:
    return os.path.join(home or keygrain_home(), "accounts")


def slug_for_email(email: str) -> str:
    """Non-secret per-account slug = sha256(email.lower())[:16] hex."""
    return hashlib.sha256(email.lower().encode("utf-8")).hexdigest()[:16]


def cache_path(email: str, home: str | None = None) -> str:
    return os.path.join(accounts_dir(home), slug_for_email(email) + ".kg")


def lock_path(email: str, home: str | None = None) -> str:
    return os.path.join(accounts_dir(home), slug_for_email(email) + ".lock")


# --- Cache key ---

def derive_cache_key(secret: bytes, account_email: str) -> bytes:
    """HMAC-SHA256(strengthen(secret,email), email.lower()+":keygrain-cli-cache")."""
    strengthened = strengthen_secret(secret, account_email)
    message = (account_email.lower() + ":" + CACHE_LABEL).encode("utf-8")
    return hmac.new(strengthened, message, hashlib.sha256).digest()


# --- Atomic write ---

def _atomic_write(path: str, data: bytes) -> None:
    """Write ``data`` to ``path`` atomically with 0600 perms and fsync durability.

    The temp file is created 0600 BEFORE any bytes are written (no window where
    the cache exists with default perms), fsync'd, then os.replace()'d into place
    (never leaves a truncated cache on crash).
    """
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    # Enforce 0700 even if umask/pre-existing dir differs.
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass

    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".tmp-", suffix=".kg")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# --- Read / write ---

def write_cache(
    secret: bytes,
    account_email: str,
    content: dict,
    *,
    server_url: str,
    synced_at: int | None = None,
    home: str | None = None,
) -> str:
    """Encrypt ``content`` and write the cache for ``account_email``. Returns path.

    ``content`` is the dict returned by ``sync_client.download_sync_content``
    (services already enriched with id/updated_at). ``server_url`` is stored
    INSIDE the encrypted body.
    """
    if synced_at is None:
        synced_at = int(time.time())

    body = {
        "server_url": server_url,
        "services": content.get("services", []),
        "wallets": content.get("wallets", []),
        "wallet_audit_log": content.get("wallet_audit_log", []),
    }
    plaintext = json.dumps(body).encode("utf-8")

    key = derive_cache_key(secret, account_email)
    iv = os.urandom(12)
    aad = account_email.lower().encode("utf-8")
    ct_and_tag = AESGCM(key).encrypt(iv, plaintext, aad)

    envelope = {
        "format": CACHE_FORMAT,
        "version": CACHE_VERSION,
        "account_email": account_email,
        "synced_at": synced_at,
        "kdf": {"type": "argon2id-strengthen", "label": CACHE_LABEL},
        "iv": base64.b64encode(iv).decode("ascii"),
        "ciphertext": base64.b64encode(ct_and_tag).decode("ascii"),
    }
    path = cache_path(account_email, home)
    _atomic_write(path, json.dumps(envelope).encode("utf-8"))
    return path


def read_cache(secret: bytes, account_email: str, home: str | None = None) -> dict:
    """Read and decrypt the cache for ``account_email``.

    Returns ``{account_email, synced_at, server_url, services, wallets,
    wallet_audit_log}``. The plaintext-header ``account_email`` is authoritative
    for key + AAD derivation (it is bound by the GCM tag).

    Raises:
        CacheNotFoundError / CacheFormatError / CacheDecryptError.
    """
    path = cache_path(account_email, home)
    if not os.path.exists(path):
        raise CacheNotFoundError(
            "No local cache. Run `keygrain sync` first."
        )
    try:
        envelope = json.loads(open(path, "rb").read().decode("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError) as exc:
        raise CacheFormatError(f"Cache file is unreadable or corrupt: {exc}") from exc

    if not isinstance(envelope, dict) or envelope.get("format") != CACHE_FORMAT:
        raise CacheFormatError("Not a keygrain cache file.")
    if envelope.get("version") != CACHE_VERSION:
        raise CacheFormatError(f"Unsupported cache version: {envelope.get('version')!r}.")

    header_email = envelope.get("account_email")
    if not isinstance(header_email, str) or not header_email:
        raise CacheFormatError("Cache is missing account_email.")

    try:
        iv = base64.b64decode(envelope["iv"], validate=True)
        ct_and_tag = base64.b64decode(envelope["ciphertext"], validate=True)
    except (KeyError, ValueError, TypeError) as exc:
        raise CacheFormatError(f"Cache has invalid iv/ciphertext: {exc}") from exc

    key = derive_cache_key(secret, header_email)
    aad = header_email.lower().encode("utf-8")
    try:
        plaintext = AESGCM(key).decrypt(iv, ct_and_tag, aad)
    except InvalidTag as exc:
        raise CacheDecryptError(
            "Failed to decrypt cache: wrong secret or the cache file was modified."
        ) from exc

    try:
        body = json.loads(plaintext.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:  # pragma: no cover - GCM guarantees integrity
        raise CacheFormatError(f"Cache body is not valid JSON: {exc}") from exc

    return {
        "account_email": header_email,
        "synced_at": envelope.get("synced_at"),
        "server_url": body.get("server_url"),
        "services": body.get("services", []),
        "wallets": body.get("wallets", []),
        "wallet_audit_log": body.get("wallet_audit_log", []),
    }


# --- Account resolution (single-account v1; multi-account-ready) ---

def list_accounts(home: str | None = None) -> list[str]:
    """Return the plaintext account emails of all cache files (sorted)."""
    directory = accounts_dir(home)
    if not os.path.isdir(directory):
        return []
    emails = []
    for name in os.listdir(directory):
        if not name.endswith(".kg"):
            continue
        try:
            envelope = json.loads(open(os.path.join(directory, name), "rb").read().decode("utf-8"))
            if isinstance(envelope, dict) and envelope.get("account_email"):
                emails.append(envelope["account_email"])
        except (OSError, ValueError, UnicodeDecodeError):
            continue
    return sorted(emails)


def resolve_account(email: str | None = None, home: str | None = None) -> str | None:
    """Resolve the account email.

    If ``email`` is given, return it. Otherwise infer the single existing
    account. Returns ``None`` if no cache exists. Raises AmbiguousAccountError
    if more than one account cache exists and none was specified.
    """
    if email:
        return email
    accounts = list_accounts(home)
    if len(accounts) == 1:
        return accounts[0]
    if len(accounts) == 0:
        return None
    raise AmbiguousAccountError(
        "Multiple accounts found; specify --email. Accounts: " + ", ".join(accounts)
    )


# --- Lock markers ---

def is_locked(email: str, home: str | None = None) -> bool:
    return os.path.exists(lock_path(email, home))


def create_lock(email: str, home: str | None = None) -> str:
    path = lock_path(email, home)
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    fd = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    try:
        os.write(fd, b"sync locked\n")
    finally:
        os.close(fd)
    return path


def remove_lock(email: str, home: str | None = None) -> bool:
    path = lock_path(email, home)
    try:
        os.unlink(path)
        return True
    except FileNotFoundError:
        return False
