"""Tests for keygrain.sync_client derivations and server-blob handling (U2).

Bit-for-bit strategy: the reimplemented _build_stream/_build_password primitives
are pinned to the already cross-platform-verified derive_password output, so any
deviation from the proven algorithm fails here. auth_password/lookup_id/
encryption_key are then exercised on top of those verified primitives.
"""

import base64
import hashlib
import json

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from keygrain.derive import derive_password, DEFAULT_SYMBOLS
from keygrain import sync_client as sc

SECRET = b"my-master-secret"
EMAIL = "test@gmail.com"


# --- Primitive equivalence: my buildStream/buildPassword == proven derive_password ---

@pytest.mark.parametrize(
    "site,email,length,symbols,counter",
    [
        ("github.com", "test@gmail.com", 20, DEFAULT_SYMBOLS, 1),
        ("github.com", "test@gmail.com", 32, DEFAULT_SYMBOLS, 2),
        ("example.org", "Alice@Example.COM", 16, "!@#$%", 1),
        ("bank.example", "bob@x.io", 24, DEFAULT_SYMBOLS, 5),
    ],
)
def test_primitives_match_derive_password(site, email, length, symbols, counter):
    from keygrain.derive import strengthen_secret

    strengthened = strengthen_secret(SECRET, email)
    message = f"{site}:{email.lower()}:{length}:{counter}".encode()
    stream = sc._build_stream(strengthened, message, length * 8)
    mine = sc._build_password(stream, length, symbols)
    expected = derive_password(
        SECRET, email, site=site, length=length, symbols=symbols, counter=counter
    )
    assert mine == expected


def test_primitives_match_all_vectors():
    """Cross-check against every password vector in vectors.json."""
    import pathlib
    from keygrain.derive import strengthen_secret, normalize_site

    root = pathlib.Path(__file__).resolve().parents[2]
    vectors = json.loads((root / "vectors.json").read_text())["vectors"]
    for v in vectors:
        secret = bytes.fromhex(v["secret_hex"])
        site = normalize_site(v["site"])
        email = v["email"].lower()
        strengthened = strengthen_secret(secret, v["email"])
        message = f"{site}:{email}:{v['length']}:{v['counter']}".encode()
        stream = sc._build_stream(strengthened, message, v["length"] * 8)
        mine = sc._build_password(stream, v["length"], v["symbols"])
        assert mine == v["expected"], v.get("_note", site)


# --- Sync credential derivations ---

def test_lookup_id_shape_and_determinism():
    lid = sc.derive_lookup_id(SECRET, EMAIL)
    assert len(lid) == 64
    int(lid, 16)  # valid hex
    assert lid == sc.derive_lookup_id(SECRET, EMAIL)


def test_lookup_id_email_case_insensitive():
    assert sc.derive_lookup_id(SECRET, "Test@Gmail.COM") == sc.derive_lookup_id(SECRET, EMAIL)


def test_derivation_regression_pins():
    # Regression pins for (secret='my-master-secret', email='test@gmail.com').
    # strengthen is independently vector-verified (test_strengthen.py); these pin
    # the full lookup_id/auth_password/encryption_key stack against silent drift.
    assert sc.derive_lookup_id(SECRET, EMAIL) == (
        "684fac7ab59b6af2d918b74b1fa19c939490cb0283911213e612fabaecb1150a"
    )
    assert sc.derive_auth_password(SECRET, EMAIL) == "yB%&MbaGEvuTY8LA%atTJzx!vW!7@5Ts"
    assert (
        sc.derive_encryption_key(SECRET, EMAIL).hex()
        == "a6e1ae7d08dd8887af7299e2ffbefd781dc4ffb1c5159e6544e275a3637b0975"
    )


def test_auth_password_shape():
    pw = sc.derive_auth_password(SECRET, EMAIL)
    assert len(pw) == 32
    assert any(c in "ABCDEFGHJKLMNPQRSTUVWXYZ" for c in pw)
    assert any(c in "abcdefghjkmnpqrstuvwxyz" for c in pw)
    assert any(c in "23456789" for c in pw)
    assert any(c in DEFAULT_SYMBOLS for c in pw)


def test_auth_password_deterministic_and_case_insensitive():
    a = sc.derive_auth_password(SECRET, EMAIL)
    assert a == sc.derive_auth_password(SECRET, EMAIL)
    assert a == sc.derive_auth_password(SECRET, "TEST@GMAIL.COM")


def test_auth_password_differs_from_derive_password():
    # auth_password uses a DIFFERENT message shape; must not equal a password
    # derived with site="keygrain-auth" (guards against the API.md trap).
    trap = derive_password(SECRET, EMAIL, site="keygrain-auth", length=32)
    assert sc.derive_auth_password(SECRET, EMAIL) != trap


def test_encryption_key_shape_and_determinism():
    k = sc.derive_encryption_key(SECRET, EMAIL)
    assert isinstance(k, bytes) and len(k) == 32
    assert k == sc.derive_encryption_key(SECRET, EMAIL)
    assert k == sc.derive_encryption_key(SECRET, "TEST@GMAIL.com")


def test_auth_and_encryption_and_lookup_are_independent():
    lid = bytes.fromhex(sc.derive_lookup_id(SECRET, EMAIL))
    enc = sc.derive_encryption_key(SECRET, EMAIL)
    assert lid != enc


# --- Server blob round-trip (build a blob exactly like the extension) ---

def _make_server_blob(enc_key: bytes, lookup_id: str, content: dict):
    """Encrypt content the way sync.js does: iv||ct||tag, AAD=lookup_id."""
    iv = b"\x01" * 12
    plaintext = json.dumps(content).encode()
    ct_and_tag = AESGCM(enc_key).encrypt(iv, plaintext, lookup_id.encode())
    decoded = iv + ct_and_tag
    return base64.b64encode(decoded).decode(), hashlib.sha256(decoded).hexdigest()


def test_blob_round_trip():
    enc = sc.derive_encryption_key(SECRET, EMAIL)
    lid = sc.derive_lookup_id(SECRET, EMAIL)
    content = {"services": [{"site": "github.com", "email": EMAIL}], "wallets": []}
    blob_b64, checksum = _make_server_blob(enc, lid, content)
    plaintext = sc.decrypt_server_blob(enc, blob_b64, lid, checksum)
    assert json.loads(plaintext) == content


def test_blob_checksum_mismatch():
    enc = sc.derive_encryption_key(SECRET, EMAIL)
    lid = sc.derive_lookup_id(SECRET, EMAIL)
    blob_b64, _ = _make_server_blob(enc, lid, {"services": []})
    with pytest.raises(sc.ChecksumMismatchError):
        sc.decrypt_server_blob(enc, blob_b64, lid, "00" * 32)


def test_blob_wrong_aad_fails_decrypt():
    enc = sc.derive_encryption_key(SECRET, EMAIL)
    lid = sc.derive_lookup_id(SECRET, EMAIL)
    blob_b64, checksum = _make_server_blob(enc, lid, {"services": []})
    with pytest.raises(sc.BlobDecryptError):
        sc.decrypt_server_blob(enc, blob_b64, "deadbeef" * 8, checksum)


def test_blob_wrong_key_fails_decrypt():
    enc = sc.derive_encryption_key(SECRET, EMAIL)
    lid = sc.derive_lookup_id(SECRET, EMAIL)
    blob_b64, checksum = _make_server_blob(enc, lid, {"services": []})
    wrong = bytes(32)
    with pytest.raises(sc.BlobDecryptError):
        sc.decrypt_server_blob(wrong, blob_b64, lid, checksum)


def test_blob_invalid_base64():
    enc = sc.derive_encryption_key(SECRET, EMAIL)
    with pytest.raises(sc.BlobDecryptError):
        sc.decrypt_server_blob(enc, "not!base64!", "ab" * 32, "00" * 32)


def test_blob_too_short():
    enc = sc.derive_encryption_key(SECRET, EMAIL)
    tiny = base64.b64encode(b"short").decode()
    checksum = hashlib.sha256(b"short").hexdigest()
    with pytest.raises(sc.BlobDecryptError):
        sc.decrypt_server_blob(enc, tiny, "ab" * 32, checksum)


# --- parse_blob_content ---

def test_parse_new_object_form():
    out = sc.parse_blob_content(
        json.dumps({"services": [1], "wallets": [2], "wallet_audit_log": [3], "sync_conflicts": [4]}).encode()
    )
    assert out == {"services": [1], "wallets": [2], "wallet_audit_log": [3], "sync_conflicts": [4]}


def test_parse_legacy_flat_array():
    out = sc.parse_blob_content(json.dumps([{"site": "x"}]).encode())
    assert out == {"services": [{"site": "x"}], "wallets": [], "wallet_audit_log": [], "sync_conflicts": []}


def test_parse_missing_keys_default_empty():
    out = sc.parse_blob_content(json.dumps({"services": [1]}).encode())
    assert out == {"services": [1], "wallets": [], "wallet_audit_log": [], "sync_conflicts": []}


# --- Read-only network GET (U3), mocked urlopen ---

import contextlib
import email.message
import io
import urllib.error


class _FakeResponse(io.BytesIO):
    def __init__(self, body: bytes, headers=None):
        super().__init__(body)
        self.headers = headers or email.message.Message()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()
        return False


def _server_payload(content: dict):
    """Build a full GET JSON payload (metadata + blob) for the given content.

    Mirrors the server: top-level services metadata carries id/updated_at; the
    blob content does NOT.
    """
    enc = sc.derive_encryption_key(SECRET, EMAIL)
    lid = sc.derive_lookup_id(SECRET, EMAIL)
    metadata = [
        {"id": s.get("id"), "updated_at": s.get("updated_at")} for s in content["services"]
    ]
    blob_services = [
        {k: v for k, v in s.items() if k not in ("id", "updated_at")} for s in content["services"]
    ]
    blob_content = {
        "services": blob_services,
        "wallets": content.get("wallets", []),
        "wallet_audit_log": content.get("wallet_audit_log", []),
        "sync_conflicts": content.get("sync_conflicts", []),
    }
    blob_b64, checksum = _make_server_blob(enc, lid, blob_content)
    return json.dumps(
        {"version": 1, "services": metadata, "encrypted_blob": blob_b64, "checksum": checksum}
    ).encode()


def test_download_enriches_id_and_updated_at(monkeypatch):
    # Real server ids are UUIDs (extension uses crypto.randomUUID); the choke
    # point now validates UUID shape, so fixtures use real UUIDs.
    uuid1 = "11111111-1111-4111-8111-111111111111"
    uuid2 = "22222222-2222-4222-8222-222222222222"
    content = {
        "services": [
            {"site": "github.com", "email": EMAIL, "id": uuid1, "updated_at": 111},
            {"site": "gitlab.com", "email": EMAIL, "id": uuid2, "updated_at": 222},
        ],
        "wallets": [{"wallet_name": "w", "chain": "bitcoin"}],
    }
    body = _server_payload(content)
    monkeypatch.setattr(sc, "_urlopen", lambda req, timeout=None: _FakeResponse(body))
    out = sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)
    assert out["services"][0]["id"] == uuid1
    assert out["services"][0]["updated_at"] == 111
    assert out["services"][1]["id"] == uuid2
    assert out["services"][0]["site"] == "github.com"
    assert out["wallets"] == [{"wallet_name": "w", "chain": "bitcoin"}]


def test_download_uses_get_and_basic_auth(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["method"] = req.get_method()
        captured["url"] = req.full_url
        captured["auth"] = req.get_header("Authorization")
        return _FakeResponse(_server_payload({"services": []}))

    monkeypatch.setattr(sc, "_urlopen", fake_urlopen)
    sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)
    assert captured["method"] == "GET"
    lid = sc.derive_lookup_id(SECRET, EMAIL)
    assert captured["url"] == "https://keygrain.com/api/sync/" + lid
    assert captured["auth"].startswith("Basic ")


def test_download_strips_trailing_slash_on_server(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        return _FakeResponse(_server_payload({"services": []}))

    monkeypatch.setattr(sc, "_urlopen", fake_urlopen)
    sc.download_sync_content("https://keygrain.com/", SECRET, EMAIL)
    assert "//api/sync" not in captured["url"]


def _raise_http(code, headers=None):
    def fake_urlopen(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, code, "err", headers or email.message.Message(), None)
    return fake_urlopen


def test_download_401(monkeypatch):
    monkeypatch.setattr(sc, "_urlopen", _raise_http(401))
    with pytest.raises(sc.AuthError):
        sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)


def test_download_404(monkeypatch):
    monkeypatch.setattr(sc, "_urlopen", _raise_http(404))
    with pytest.raises(sc.NotFoundError):
        sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)


def test_download_429_with_retry_after(monkeypatch):
    hdrs = email.message.Message()
    hdrs["Retry-After"] = "42"
    monkeypatch.setattr(sc, "_urlopen", _raise_http(429, hdrs))
    with pytest.raises(sc.RateLimitedError) as ei:
        sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)
    assert ei.value.retry_after == 42


def test_download_500_server_error(monkeypatch):
    monkeypatch.setattr(sc, "_urlopen", _raise_http(500))
    with pytest.raises(sc.ServerError):
        sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)


def test_download_network_error(monkeypatch):
    def fake_urlopen(req, timeout=None):
        raise urllib.error.URLError("no route")
    monkeypatch.setattr(sc, "_urlopen", fake_urlopen)
    with pytest.raises(sc.NetworkError):
        sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)


def test_download_malformed_json(monkeypatch):
    monkeypatch.setattr(sc, "_urlopen", lambda req, timeout=None: _FakeResponse(b"not json"))
    with pytest.raises(sc.SyncError):
        sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)


def test_download_missing_fields(monkeypatch):
    body = json.dumps({"version": 1, "services": []}).encode()
    monkeypatch.setattr(sc, "_urlopen", lambda req, timeout=None: _FakeResponse(body))
    with pytest.raises(sc.SyncError):
        sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)


def test_download_metadata_length_mismatch(monkeypatch):
    # Metadata has 2 entries but blob content has 1 -> refuse.
    enc = sc.derive_encryption_key(SECRET, EMAIL)
    lid = sc.derive_lookup_id(SECRET, EMAIL)
    blob_b64, checksum = _make_server_blob(enc, lid, {"services": [{"site": "a"}]})
    body = json.dumps({
        "version": 1,
        "services": [{"id": "x", "updated_at": 1}, {"id": "y", "updated_at": 2}],
        "encrypted_blob": blob_b64,
        "checksum": checksum,
    }).encode()
    monkeypatch.setattr(sc, "_urlopen", lambda req, timeout=None: _FakeResponse(body))
    with pytest.raises(sc.SyncError):
        sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)


def test_download_oversize_response(monkeypatch):
    big = b"x" * (sc.MAX_RESPONSE_BYTES + 10)
    monkeypatch.setattr(sc, "_urlopen", lambda req, timeout=None: _FakeResponse(big))
    with pytest.raises(sc.ServerError):
        sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)


def test_no_write_method_in_module():
    # Structural read-only guarantee: no PUT/POST/DELETE anywhere in the source.
    import pathlib
    src = pathlib.Path(sc.__file__).read_text()
    for verb in ('"PUT"', "'PUT'", '"POST"', "'POST'", '"DELETE"', "'DELETE'", "method=\"PUT\""):
        assert verb not in src


# --- Redirect blocking (U1): credentials must never follow a 3xx to another host ---

import email.message as _emsg


@pytest.mark.parametrize("code", [301, 302, 303, 307, 308])
def test_redirect_request_raises_and_returns_no_request(code):
    """The single funnel raises for EVERY 3xx, so no follow-up Request is ever
    built — a leak requires a Request to host2, which never exists."""
    handler = sc._NoRedirectHandler()
    req = urllib.request.Request(
        "https://keygrain.com/api/sync/abc",
        method="GET",
        headers={"Authorization": "Basic c2VjcmV0"},
    )
    with pytest.raises(urllib.error.HTTPError) as ei:
        handler.redirect_request(
            req, io.BytesIO(b""), code, "Found",
            _emsg.Message(), "https://evil.example/harvest",
        )
    # It raised rather than returning a Request pointed at evil.example.
    assert ei.value.code == code


def test_opener_installed_noredirect_handler():
    """build_opener must have REPLACED the default HTTPRedirectHandler with ours
    (subclass de-dup), else redirects would silently follow."""
    redirect_handlers = [
        h for h in sc._OPENER.handlers
        if isinstance(h, urllib.request.HTTPRedirectHandler)
    ]
    assert redirect_handlers, "no redirect handler installed"
    assert all(isinstance(h, sc._NoRedirectHandler) for h in redirect_handlers), (
        "default HTTPRedirectHandler still present — redirects would be followed"
    )


def test_default_handler_would_follow_contrast():
    """Sanity contrast: the STOCK handler returns a Request (i.e. would follow +
    re-send the Authorization header). Proves our override changes behavior."""
    stock = urllib.request.HTTPRedirectHandler()
    req = urllib.request.Request(
        "https://keygrain.com/api/sync/abc", method="GET",
        headers={"Authorization": "Basic c2VjcmV0"},
    )
    follow = stock.redirect_request(
        req, io.BytesIO(b""), 302, "Found", _emsg.Message(),
        "https://evil.example/harvest",
    )
    assert follow is not None and "evil.example" in follow.full_url


def test_http_get_maps_302_to_server_error_without_contacting_host2(monkeypatch):
    """A 302 surfaces as a clear ServerError; the second host is never contacted."""
    contacted = []

    def fake_urlopen(request, timeout=None):
        contacted.append(request.full_url)
        # Simulate what _OPENER does on a blocked redirect: raise HTTPError(302).
        raise urllib.error.HTTPError(
            request.full_url, 302, "Redirect blocked", _emsg.Message(), io.BytesIO(b"")
        )

    monkeypatch.setattr(sc, "_urlopen", fake_urlopen)
    with pytest.raises(sc.ServerError) as ei:
        sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)
    assert "redirect" in str(ei.value).lower()
    # Only the original host was ever contacted.
    assert contacted == ["https://keygrain.com/api/sync/" + sc.derive_lookup_id(SECRET, EMAIL)]
    assert not any("evil" in u for u in contacted)


# --- Metadata sanitization (U2): unauthenticated top-level metadata is hostile ---

_VALID_UUID = "550e8400-e29b-41d4-a716-446655440000"


def test_sanitize_non_dict_element_returns_none_none():
    # No AttributeError crash on non-dict metadata elements.
    for bad in ("a string", 42, ["list"], None, True):
        assert sc._sanitize_metadata_element(bad) == (None, None)


def test_download_does_not_crash_on_non_dict_metadata(monkeypatch):
    """A hostile server returning non-dict metadata elements must not crash
    (previously meta.get(...) raised AttributeError)."""
    enc = sc.derive_encryption_key(SECRET, EMAIL)
    lid = sc.derive_lookup_id(SECRET, EMAIL)
    # Two blob services, but metadata elements are a string and a number.
    blob_b64, checksum = _make_server_blob(
        enc, lid, {"services": [{"site": "a.com", "email": EMAIL},
                                {"site": "b.com", "email": EMAIL}],
                   "wallets": [], "wallet_audit_log": [], "sync_conflicts": []}
    )
    body = json.dumps({
        "version": 1,
        "services": ["not-a-dict", 12345],
        "encrypted_blob": blob_b64,
        "checksum": checksum,
    }).encode()
    monkeypatch.setattr(sc, "_urlopen", lambda req, timeout=None: _FakeResponse(body))
    out = sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)
    # No crash; ids/updated_at dropped to None, blob-authenticated fields intact.
    assert out["services"][0]["id"] is None
    assert out["services"][0]["updated_at"] is None
    assert out["services"][0]["site"] == "a.com"
    assert out["services"][1]["id"] is None


def test_sanitize_control_chars_in_id_dropped():
    # An id carrying an ANSI escape sequence is NOT UUID-shaped after stripping
    # control chars -> dropped to None, so it can never reach stdout/stderr.
    evil = "\x1b[31m" + _VALID_UUID + "\x07"
    clean_id, _ = sc._sanitize_metadata_element({"id": evil, "updated_at": 1})
    assert clean_id is None


def test_sanitize_valid_uuid_preserved():
    clean_id, ts = sc._sanitize_metadata_element({"id": _VALID_UUID, "updated_at": 99})
    assert clean_id == _VALID_UUID
    assert ts == 99


def test_sanitize_uppercase_uuid_preserved():
    # Permissive (case-insensitive) shape — do not drop legit ids.
    up = _VALID_UUID.upper()
    clean_id, _ = sc._sanitize_metadata_element({"id": up, "updated_at": 0})
    assert clean_id == up


def test_sanitize_non_uuid_id_dropped():
    for bad in ("uuid-1", "", "not-a-uuid", "123", "550e8400e29b41d4a716446655440000"):
        clean_id, _ = sc._sanitize_metadata_element({"id": bad, "updated_at": 1})
        assert clean_id is None, bad


def test_sanitize_id_non_string_dropped():
    for bad in (12345, ["x"], {"k": "v"}, None, True):
        clean_id, _ = sc._sanitize_metadata_element({"id": bad, "updated_at": 1})
        assert clean_id is None


@pytest.mark.parametrize("raw,expected", [
    (111, 111),
    (111.9, 111),
    ("222", 222),
    ("  333 ", 333),
    ("-5", -5),
    ("not-a-number", None),
    ("12.5", None),           # non-integer string -> None
    (True, None),            # bool rejected (not a timestamp)
    (False, None),
    (None, None),
    ([1], None),
    ({"a": 1}, None),
])
def test_sanitize_updated_at_coercion(raw, expected):
    _, ts = sc._sanitize_metadata_element({"id": _VALID_UUID, "updated_at": raw})
    assert ts == expected


def test_sanitized_values_are_what_gets_cached(monkeypatch, tmp_path):
    """The SANITIZED id/updated_at (not the raw hostile values) are what
    download returns and therefore what write_cache persists -> list AND get
    (which read the cache) both benefit."""
    from keygrain import cache as cache_mod
    monkeypatch.setattr(cache_mod, "keygrain_home", lambda: str(tmp_path / "kg"))

    enc = sc.derive_encryption_key(SECRET, EMAIL)
    lid = sc.derive_lookup_id(SECRET, EMAIL)
    blob_b64, checksum = _make_server_blob(
        enc, lid, {"services": [{"site": "x.com", "email": EMAIL}],
                   "wallets": [], "wallet_audit_log": [], "sync_conflicts": []}
    )
    body = json.dumps({
        "version": 1,
        "services": [{"id": "\x1b[31mnot-a-uuid", "updated_at": "77"}],
        "encrypted_blob": blob_b64,
        "checksum": checksum,
    }).encode()
    monkeypatch.setattr(sc, "_urlopen", lambda req, timeout=None: _FakeResponse(body))
    content = sc.download_sync_content("https://keygrain.com", SECRET, EMAIL)
    cache_mod.write_cache(SECRET, EMAIL, content, server_url="https://keygrain.com")
    data = cache_mod.read_cache(SECRET, EMAIL)
    svc = data["services"][0]
    assert svc["id"] is None            # hostile non-UUID id dropped
    assert svc["updated_at"] == 77       # coerced from "77" to int
    # No control chars survive anywhere in the cached service.
    assert "\x1b" not in json.dumps(svc)
