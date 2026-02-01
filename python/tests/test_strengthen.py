"""Tests for Argon2id strengthen functionality."""

import time

import pytest

from keygrain import derive_password, strengthen_secret, clear_strengthen_cache


def test_strengthen_deterministic():
    a = derive_password(b"my-master-secret", "test@gmail.com", site="github.com")
    b = derive_password(b"my-master-secret", "test@gmail.com", site="github.com")
    assert a == b


def test_strengthen_vector():
    result = derive_password(b"my-master-secret", "test@gmail.com", site="github.com")
    assert result == "?X_BAbv4UHAfw=kYV$mh"


def test_strengthen_different_email():
    a = derive_password(b"my-master-secret", "test@gmail.com", site="github.com")
    b = derive_password(b"my-master-secret", "user@example.com", site="github.com")
    assert a != b


def test_strengthen_case_insensitive_email():
    a = derive_password(b"my-master-secret", "TEST@Gmail.COM", site="github.com")
    b = derive_password(b"my-master-secret", "test@gmail.com", site="github.com")
    assert a == b


def test_strengthen_secret_direct():
    result = strengthen_secret(b"my-master-secret", "test@gmail.com")
    assert isinstance(result, bytes)
    assert len(result) == 32


def test_clear_strengthen_cache():
    strengthen_secret(b"test", "a@b.com")
    clear_strengthen_cache()
    result = strengthen_secret(b"test", "a@b.com")
    assert len(result) == 32


def test_strengthen_performance():
    clear_strengthen_cache()
    start = time.time()
    derive_password(b"perf-test", "perf@test.com", site="perf.com")
    first_call = time.time() - start
    assert first_call > 0.1, f"First call too fast ({first_call:.3f}s) — Argon2id may not be running"

    start = time.time()
    derive_password(b"perf-test", "perf@test.com", site="perf.com")
    second_call = time.time() - start
    assert second_call < 0.01, f"Second call too slow ({second_call:.3f}s) — cache may not be working"
