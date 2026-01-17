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


def test_empty_symbols_rejected():
    with pytest.raises(ValueError):
        derive_password(b"secret", "a@b.com", site="example.com", symbols="")


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
