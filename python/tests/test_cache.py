"""Tests for keygrain.cache (local encrypted cache, locks, account resolution)."""

import base64
import json
import os
import stat

import pytest

from keygrain import cache

SECRET = b"my-master-secret"
EMAIL = "me@example.com"
CONTENT = {
    "services": [
        {"site": "github.com", "email": EMAIL, "length": 20, "id": "uuid-1", "updated_at": 111},
    ],
    "wallets": [{"wallet_name": "w", "chain": "bitcoin"}],
    "wallet_audit_log": [{"action": "create"}],
}


@pytest.fixture
def home(tmp_path, monkeypatch):
    h = str(tmp_path / "kg")
    # Inject the cache root for tests by patching the default resolver
    # (no product env override exists — see design "simple + explicit").
    monkeypatch.setattr(cache, "keygrain_home", lambda: h)
    return h


def test_slug_is_deterministic_and_case_insensitive():
    assert cache.slug_for_email("Me@Example.com") == cache.slug_for_email(EMAIL)
    assert len(cache.slug_for_email(EMAIL)) == 16


def test_keygrain_home_default():
    assert cache.keygrain_home().endswith(".keygrain")
    assert cache.accounts_dir().endswith(os.path.join(".keygrain", "accounts"))


def test_cache_key_deterministic_and_case_insensitive():
    k1 = cache.derive_cache_key(SECRET, EMAIL)
    k2 = cache.derive_cache_key(SECRET, "ME@EXAMPLE.COM")
    assert k1 == k2 and len(k1) == 32


def test_write_then_read_round_trip(home):
    path = cache.write_cache(SECRET, EMAIL, CONTENT, server_url="https://keygrain.com", synced_at=999)
    assert os.path.exists(path)
    out = cache.read_cache(SECRET, EMAIL)
    assert out["account_email"] == EMAIL
    assert out["synced_at"] == 999
    assert out["server_url"] == "https://keygrain.com"
    assert out["services"][0]["id"] == "uuid-1"
    assert out["wallets"] == CONTENT["wallets"]
    assert out["wallet_audit_log"] == CONTENT["wallet_audit_log"]


def test_server_url_not_in_plaintext_header(home):
    cache.write_cache(SECRET, EMAIL, CONTENT, server_url="https://secret-host.example")
    envelope = json.loads(open(cache.cache_path(EMAIL)).read())
    # Header must NOT leak server_url; it lives inside the ciphertext.
    assert "server_url" not in envelope
    assert "secret-host" not in json.dumps(envelope)
    assert envelope["account_email"] == EMAIL  # email IS plaintext (deliberate)


def test_file_permissions_0600(home):
    path = cache.write_cache(SECRET, EMAIL, CONTENT, server_url="https://keygrain.com")
    mode = stat.S_IMODE(os.stat(path).st_mode)
    assert mode == 0o600
    dir_mode = stat.S_IMODE(os.stat(cache.accounts_dir()).st_mode)
    assert dir_mode == 0o700


def test_wrong_secret_fails_decrypt(home):
    cache.write_cache(SECRET, EMAIL, CONTENT, server_url="https://keygrain.com")
    with pytest.raises(cache.CacheDecryptError):
        cache.read_cache(b"wrong-secret", EMAIL)


def test_tampered_header_email_fails_aad(home):
    cache.write_cache(SECRET, EMAIL, CONTENT, server_url="https://keygrain.com")
    path = cache.cache_path(EMAIL)
    envelope = json.loads(open(path).read())
    # Edit the plaintext header email but keep the file at the same path.
    envelope["account_email"] = "attacker@evil.com"
    open(path, "w").write(json.dumps(envelope))
    # read_cache uses the (tampered) header email for key+AAD -> decrypt fails.
    with pytest.raises(cache.CacheDecryptError):
        cache.read_cache(SECRET, EMAIL)


def test_tampered_ciphertext_fails(home):
    cache.write_cache(SECRET, EMAIL, CONTENT, server_url="https://keygrain.com")
    path = cache.cache_path(EMAIL)
    envelope = json.loads(open(path).read())
    raw = bytearray(base64.b64decode(envelope["ciphertext"]))
    raw[0] ^= 0xFF
    envelope["ciphertext"] = base64.b64encode(bytes(raw)).decode()
    open(path, "w").write(json.dumps(envelope))
    with pytest.raises(cache.CacheDecryptError):
        cache.read_cache(SECRET, EMAIL)


def test_read_missing_cache(home):
    with pytest.raises(cache.CacheNotFoundError):
        cache.read_cache(SECRET, EMAIL)


def test_bad_format_rejected(home):
    os.makedirs(cache.accounts_dir(), exist_ok=True)
    open(cache.cache_path(EMAIL), "w").write(json.dumps({"format": "nope"}))
    with pytest.raises(cache.CacheFormatError):
        cache.read_cache(SECRET, EMAIL)


def test_bad_version_rejected(home):
    os.makedirs(cache.accounts_dir(), exist_ok=True)
    open(cache.cache_path(EMAIL), "w").write(
        json.dumps({"format": cache.CACHE_FORMAT, "version": 99, "account_email": EMAIL})
    )
    with pytest.raises(cache.CacheFormatError):
        cache.read_cache(SECRET, EMAIL)


def test_corrupt_json_rejected(home):
    os.makedirs(cache.accounts_dir(), exist_ok=True)
    open(cache.cache_path(EMAIL), "w").write("{not json")
    with pytest.raises(cache.CacheFormatError):
        cache.read_cache(SECRET, EMAIL)


def test_atomic_write_leaves_no_temp(home):
    cache.write_cache(SECRET, EMAIL, CONTENT, server_url="https://keygrain.com")
    leftovers = [n for n in os.listdir(cache.accounts_dir()) if n.startswith(".tmp-")]
    assert leftovers == []


# --- Locks ---

def test_lock_lifecycle(home):
    assert not cache.is_locked(EMAIL)
    p = cache.create_lock(EMAIL)
    assert cache.is_locked(EMAIL)
    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600
    assert cache.remove_lock(EMAIL) is True
    assert not cache.is_locked(EMAIL)
    assert cache.remove_lock(EMAIL) is False  # idempotent


# --- Account resolution ---

def test_resolve_account_explicit(home):
    assert cache.resolve_account("given@x.com") == "given@x.com"


def test_resolve_account_none_when_empty(home):
    assert cache.resolve_account() is None


def test_resolve_account_single_inferred(home):
    cache.write_cache(SECRET, EMAIL, CONTENT, server_url="https://keygrain.com")
    assert cache.resolve_account() == EMAIL


def test_resolve_account_ambiguous(home):
    cache.write_cache(SECRET, "a@x.com", CONTENT, server_url="https://keygrain.com")
    cache.write_cache(SECRET, "b@x.com", CONTENT, server_url="https://keygrain.com")
    with pytest.raises(cache.AmbiguousAccountError):
        cache.resolve_account()


def test_list_accounts_sorted(home):
    cache.write_cache(SECRET, "b@x.com", CONTENT, server_url="https://keygrain.com")
    cache.write_cache(SECRET, "a@x.com", CONTENT, server_url="https://keygrain.com")
    assert cache.list_accounts() == ["a@x.com", "b@x.com"]
