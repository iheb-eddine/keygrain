"""Tests for Argon2id strengthen functionality."""

import time

import pytest

from keygrain import derive_password, strengthen_secret, clear_strengthen_cache


def test_strengthen_deterministic():
    a = derive_password(b"my-master-secret", "test@gmail.com", strengthen=True)
    b = derive_password(b"my-master-secret", "test@gmail.com", strengthen=True)
    assert a == b


def test_strengthen_differs_from_default():
    plain = derive_password(b"my-master-secret", "test@gmail.com", strengthen=False)
    strong = derive_password(b"my-master-secret", "test@gmail.com", strengthen=True)
    assert plain != strong


def test_strengthen_vector():
    result = derive_password(b"my-master-secret", "test@gmail.com", strengthen=True)
    assert result == "sTnWNzmNPs?AUMAYr6!n"


def test_strengthen_different_email():
    a = derive_password(b"my-master-secret", "test@gmail.com", strengthen=True)
    b = derive_password(b"my-master-secret", "user@example.com", strengthen=True)
    assert a != b


def test_strengthen_with_salt():
    a = derive_password(b"my-master-secret", "test@gmail.com", strengthen=True)
    b = derive_password(b"my-master-secret", "test@gmail.com", salt="v2", strengthen=True)
    assert a != b
    assert b == "!45#djLj78zx5pV+y77R"


def test_strengthen_case_insensitive_email():
    a = derive_password(b"my-master-secret", "TEST@Gmail.COM", strengthen=True)
    b = derive_password(b"my-master-secret", "test@gmail.com", strengthen=True)
    assert a == b


def test_strengthen_secret_direct():
    result = strengthen_secret(b"my-master-secret", "test@gmail.com")
    assert isinstance(result, bytes)
    assert len(result) == 32


def test_clear_strengthen_cache():
    strengthen_secret(b"test", "a@b.com")
    clear_strengthen_cache()
    # After clearing, calling again should still work (recomputes)
    result = strengthen_secret(b"test", "a@b.com")
    assert len(result) == 32


def test_strengthen_performance():
    clear_strengthen_cache()
    start = time.time()
    derive_password(b"perf-test", "perf@test.com", strengthen=True)
    first_call = time.time() - start
    assert first_call > 0.1, f"First call too fast ({first_call:.3f}s) — Argon2id may not be running"

    start = time.time()
    derive_password(b"perf-test", "perf@test.com", strengthen=True)
    second_call = time.time() - start
    assert second_call < 0.01, f"Second call too slow ({second_call:.3f}s) — cache may not be working"
