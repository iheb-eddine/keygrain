"""Tests for keygrain derivation against cross-platform vectors."""

import json
from pathlib import Path

import pytest

from keygrain import derive_password, DEFAULT_SYMBOLS

VECTORS_PATH = Path(__file__).parent.parent.parent / "vectors.json"


def test_all_vectors():
    data = json.loads(VECTORS_PATH.read_text())
    for v in data["vectors"]:
        result = derive_password(
            secret=v["secret_utf8"].encode(),
            email=v["email"],
            length=v["length"],
            symbols=v["symbols"],
            salt=v["salt"],
        )
        assert result == v["expected"], (
            f"Failed for {v['email']} (len={v['length']}, salt={v['salt']!r}): "
            f"got {result!r}, expected {v['expected']!r}"
        )


def test_minimum_length_rejected():
    with pytest.raises(ValueError):
        derive_password(b"secret", "a@b.com", length=7)


def test_empty_symbols_rejected():
    with pytest.raises(ValueError):
        derive_password(b"secret", "a@b.com", symbols="")


def test_password_contains_all_categories():
    pw = derive_password(b"test", "user@example.com", length=20)
    assert any(c.isupper() for c in pw)
    assert any(c.islower() for c in pw)
    assert any(c.isdigit() for c in pw)
    assert any(c in DEFAULT_SYMBOLS for c in pw)


def test_deterministic():
    a = derive_password(b"secret", "x@y.com")
    b = derive_password(b"secret", "x@y.com")
    assert a == b


def test_case_insensitive_email():
    a = derive_password(b"secret", "User@Example.COM")
    b = derive_password(b"secret", "user@example.com")
    assert a == b


def test_different_length_different_output():
    a = derive_password(b"secret", "x@y.com", length=16)
    b = derive_password(b"secret", "x@y.com", length=20)
    assert a != b


def test_different_salt_different_output():
    a = derive_password(b"secret", "x@y.com", salt="")
    b = derive_password(b"secret", "x@y.com", salt="v2")
    assert a != b


def test_different_symbols_different_output():
    a = derive_password(b"secret", "x@y.com", symbols="!@#$%&*-_=+?")
    b = derive_password(b"secret", "x@y.com", symbols="!@#$%")
    assert a != b
