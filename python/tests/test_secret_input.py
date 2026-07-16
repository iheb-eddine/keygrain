"""Tests for keygrain.secret_input (master-secret resolution)."""

import os
import stat

import pytest

from keygrain.secret_input import resolve_secret, SecretResolutionError


def test_env_source(monkeypatch):
    monkeypatch.setenv("MY_SECRET", "hunter2")
    assert resolve_secret(secret_env="MY_SECRET") == b"hunter2"


def test_env_missing_raises(monkeypatch):
    monkeypatch.delenv("NOPE", raising=False)
    with pytest.raises(SecretResolutionError):
        resolve_secret(secret_env="NOPE")


def test_env_empty_raises(monkeypatch):
    monkeypatch.setenv("EMPTY", "")
    with pytest.raises(SecretResolutionError):
        resolve_secret(secret_env="EMPTY")


def test_both_sources_raises(tmp_path):
    f = tmp_path / "s"
    f.write_text("x")
    with pytest.raises(SecretResolutionError):
        resolve_secret(secret_env="X", secret_file=str(f))


def test_file_source(tmp_path):
    f = tmp_path / "secret"
    f.write_bytes(b"filesecret")
    os.chmod(f, 0o600)
    assert resolve_secret(secret_file=str(f)) == b"filesecret"


def test_file_strips_single_trailing_newline(tmp_path):
    f = tmp_path / "secret"
    f.write_bytes(b"abc\n")
    os.chmod(f, 0o600)
    assert resolve_secret(secret_file=str(f)) == b"abc"


def test_file_strips_crlf(tmp_path):
    f = tmp_path / "secret"
    f.write_bytes(b"abc\r\n")
    os.chmod(f, 0o600)
    assert resolve_secret(secret_file=str(f)) == b"abc"


def test_file_keeps_internal_newlines(tmp_path):
    f = tmp_path / "secret"
    f.write_bytes(b"a\nb\n")
    os.chmod(f, 0o600)
    # Only ONE trailing newline stripped.
    assert resolve_secret(secret_file=str(f)) == b"a\nb"


def test_file_missing_raises(tmp_path):
    with pytest.raises(SecretResolutionError):
        resolve_secret(secret_file=str(tmp_path / "does-not-exist"))


def test_file_empty_after_strip_raises(tmp_path):
    f = tmp_path / "secret"
    f.write_bytes(b"\n")
    os.chmod(f, 0o600)
    with pytest.raises(SecretResolutionError):
        resolve_secret(secret_file=str(f))


def test_file_perm_warning_nonfatal(tmp_path, capsys):
    f = tmp_path / "secret"
    f.write_bytes(b"loose")
    os.chmod(f, 0o644)
    result = resolve_secret(secret_file=str(f))
    assert result == b"loose"
    err = capsys.readouterr().err
    assert "broader than 0600" in err


def test_file_no_warning_when_0600(tmp_path, capsys):
    f = tmp_path / "secret"
    f.write_bytes(b"tight")
    os.chmod(f, 0o600)
    resolve_secret(secret_file=str(f))
    assert "broader than 0600" not in capsys.readouterr().err


def test_prompt_used_when_tty(monkeypatch):
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("keygrain.secret_input.getpass.getpass", lambda *a, **k: "prompted")
    assert resolve_secret() == b"prompted"


def test_prompt_empty_raises(monkeypatch):
    monkeypatch.setattr("sys.stdin.isatty", lambda: True)
    monkeypatch.setattr("keygrain.secret_input.getpass.getpass", lambda *a, **k: "")
    with pytest.raises(SecretResolutionError):
        resolve_secret()


def test_non_interactive_no_source_raises(monkeypatch):
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    with pytest.raises(SecretResolutionError):
        resolve_secret()
