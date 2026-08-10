"""Tests for keygrain derivation against cross-platform vectors."""

import json
from pathlib import Path

import pytest

from keygrain import derive_password, strengthen_secret, clear_strengthen_cache, DEFAULT_SYMBOLS

VECTORS_PATH = Path(__file__).parent.parent.parent / "vectors.json"


def test_all_vectors():
    data = json.loads(VECTORS_PATH.read_text())
    for v in data["vectors"]:
        result = derive_password(
            secret=bytes.fromhex(v["secret_hex"]),
            email=v["email"],
            site=v["site"],
            length=v["length"],
            symbols=v["symbols"],
            counter=v["counter"],
        )
        assert result == v["expected"], (
            f"Failed for site={v['site']!r} email={v['email']} "
            f"(len={v['length']}, counter={v['counter']}): "
            f"got {result!r}, expected {v['expected']!r}"
        )


def test_strengthen_vectors():
    data = json.loads(VECTORS_PATH.read_text())
    for v in data["strengthen_vectors"]:
        clear_strengthen_cache()
        result = strengthen_secret(bytes.fromhex(v["secret_hex"]), v["email"])
        assert result.hex() == v["expected_hex"], (
            f"Failed for secret={v['secret_utf8']!r} email={v['email']}: "
            f"got {result.hex()!r}, expected {v['expected_hex']!r}"
        )


def test_minimum_length_rejected():
    with pytest.raises(ValueError):
        derive_password(b"secret", "a@b.com", site="example.com", length=7)


def test_maximum_length_rejected():
    with pytest.raises(ValueError):
        derive_password(b"secret", "a@b.com", site="example.com", length=129)


def test_empty_symbols_rejected():
    with pytest.raises(ValueError):
        derive_password(b"secret", "a@b.com", site="example.com", symbols="")


def test_symbols_too_large_rejected():
    with pytest.raises(ValueError, match="charset size"):
        derive_password(b"secret", "a@b.com", site="example.com", symbols="!" * 202)


def test_empty_email_rejected():
    with pytest.raises(ValueError):
        derive_password(b"secret", "", site="example.com")


def test_whitespace_only_email_rejected():
    with pytest.raises(ValueError):
        derive_password(b"secret", "   ", site="example.com")


def test_empty_site_rejected():
    with pytest.raises(ValueError):
        derive_password(b"secret", "a@b.com", site="")


def test_password_contains_all_categories():
    pw = derive_password(b"test", "user@example.com", site="example.com", length=20)
    assert any(c.isupper() for c in pw)
    assert any(c.islower() for c in pw)
    assert any(c.isdigit() for c in pw)
    assert any(c in DEFAULT_SYMBOLS for c in pw)


def test_deterministic():
    a = derive_password(b"secret", "x@y.com", site="y.com")
    b = derive_password(b"secret", "x@y.com", site="y.com")
    assert a == b


def test_case_insensitive_email():
    a = derive_password(b"secret", "User@Example.COM", site="example.com")
    b = derive_password(b"secret", "user@example.com", site="example.com")
    assert a == b


def test_case_insensitive_site():
    a = derive_password(b"secret", "x@y.com", site="GitHub.com")
    b = derive_password(b"secret", "x@y.com", site="github.com")
    assert a == b


def test_different_length_different_output():
    a = derive_password(b"secret", "x@y.com", site="y.com", length=16)
    b = derive_password(b"secret", "x@y.com", site="y.com", length=20)
    assert a != b


def test_different_symbols_different_output():
    a = derive_password(b"secret", "x@y.com", site="y.com", symbols="!@#$%&*-_=+?")
    b = derive_password(b"secret", "x@y.com", site="y.com", symbols="!@#$%")
    assert a != b


def test_different_site_different_output():
    a = derive_password(b"secret", "x@y.com", site="github.com")
    b = derive_password(b"secret", "x@y.com", site="google.com")
    assert a != b


def test_different_counter_different_output():
    a = derive_password(b"secret", "x@y.com", site="y.com", counter=1)
    b = derive_password(b"secret", "x@y.com", site="y.com", counter=2)
    assert a != b


def test_rejection_sampling_boundary():
    """Bytes >= limit must be rejected; bytes < limit accepted.

    For charset 67, limit = (256 // 67) * 67 = 201.
    Byte 201 at a charset-67 position must be skipped (same output as without it).
    Byte 200 at the same position must be accepted (different output).
    """
    from unittest.mock import patch, MagicMock

    # First 4 bytes consumed by mandatory chars (charsets 24, 23, 8, 12).
    # Position 4 onward consumed by fill chars (charset 67).
    # Use small values that pass all charset limits.
    base = bytes([10, 5, 3, 7, 20, 30, 40, 50, 3, 2, 1, 6, 5, 4, 0])

    # Stream with byte 201 inserted at position 4 (charset-67 boundary)
    with_rejected = bytes([10, 5, 3, 7, 201]) + base[4:]

    # Stream with byte 200 at position 4 (just below limit, accepted)
    with_accepted = bytes([10, 5, 3, 7, 200]) + base[4:]

    def make_derive(stream_bytes):
        """Call derive_password with a mocked byte stream."""
        padded = stream_bytes + bytes(64 - len(stream_bytes))  # pad to 64 bytes
        with patch("keygrain.derive.strengthen_secret", return_value=b"\x00" * 32):
            with patch("keygrain.derive.hmac.new", side_effect=[
                # First call: initial key (also first 32 bytes of stream)
                MagicMock(digest=MagicMock(return_value=padded[:32])),
                # Second call: expansion (next 32 bytes)
                MagicMock(digest=MagicMock(return_value=padded[32:64])),
            ]):
                return derive_password(
                    b"x", "a@b.com", site="s.com", length=8
                )

    pw_base = make_derive(base)
    pw_rejected = make_derive(with_rejected)
    pw_accepted = make_derive(with_accepted)

    # Byte 201 (== limit) must be rejected → same password as base
    assert pw_base == pw_rejected, (
        f"Byte 201 should be rejected but changed output: "
        f"base={pw_base!r}, with_201={pw_rejected!r}"
    )
    # Byte 200 (< limit) must be accepted → different password
    assert pw_base != pw_accepted, (
        f"Byte 200 should be accepted but output unchanged: "
        f"base={pw_base!r}, with_200={pw_accepted!r}"
    )


def test_ascii_printable_boundaries_and_invalid_symbols():
    for symbols in ("!", "~", "!~", "!!A"):
        result = derive_password(b"secret", "a@b.com", site="example.com", symbols=symbols)
        assert len(result) == 20
    for symbols in ("", " ", "\x1f", "\x7f", "é", "😀", None):
        with pytest.raises(ValueError):
            derive_password(b"secret", "a@b.com", site="example.com", symbols=symbols)


def test_unknown_symbol_policy_rejected_before_strengthening(monkeypatch):
    called = False

    def fail_if_called(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("strengthening must not run for invalid symbols")

    monkeypatch.setattr("keygrain.derive.strengthen_secret", fail_if_called)
    with pytest.raises(ValueError, match="graphic printable ASCII"):
        derive_password(b"secret", "a@b.com", site="example.com", symbols=" ")
    assert not called
    with pytest.raises(ValueError, match="Unknown symbol policy"):
        derive_password(b"secret", "a@b.com", site="example.com", policy="future-unicode")
    assert not called



def test_symbol_sequence_semantics_have_exact_outputs():
    expected = {
        "!A": "Whv6dVxdG4wYAUAXF43M",
        "A!": "Whv6dVxdG4wY!UAXF43M",
        "!!A": "Ugs4bVwaF2wYAUAUC4yL",
        "!1": "Whv6dVxdG4wY1UAXF43M",
    }
    actual = {
        symbols: derive_password(
            b"my-master-secret",
            "test@gmail.com",
            site="github.com",
            length=20,
            symbols=symbols,
            counter=1,
        )
        for symbols in expected
    }
    assert actual == expected
    assert actual["!A"] != actual["A!"]
    assert actual["!!A"] != actual["!A"]
    assert actual["!1"] != actual["!A"]
