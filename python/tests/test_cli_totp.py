"""Tests for the totp CLI subcommand."""

import sys
from unittest.mock import patch

import pytest

from keygrain.cli import main
from keygrain.totp import generate_totp, parse_totp_input, derive_totp_seed
from keygrain.derive import normalize_site


FIXED_TIME = 1700000000


class TestTOTPModelA:
    """Model A: stored seed via --seed flag."""

    def test_base32_seed(self, capsys, monkeypatch):
        monkeypatch.setattr(sys, "argv", ["keygrain", "totp", "--seed", "JBSWY3DPEHPK3PXP"])
        with patch("keygrain.cli.time") as mock_time:
            mock_time.time.return_value = FIXED_TIME
            main()
        out = capsys.readouterr().out.strip()
        params = parse_totp_input("JBSWY3DPEHPK3PXP")
        expected = generate_totp(params["seed"], FIXED_TIME, digits=6, period=30)
        assert out == expected

    def test_otpauth_uri(self, capsys, monkeypatch):
        uri = "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=8&period=60"
        monkeypatch.setattr(sys, "argv", ["keygrain", "totp", "--seed", uri])
        with patch("keygrain.cli.time") as mock_time:
            mock_time.time.return_value = FIXED_TIME
            main()
        out = capsys.readouterr().out.strip()
        params = parse_totp_input(uri)
        expected = generate_totp(params["seed"], FIXED_TIME, digits=8, period=60)
        assert out == expected

    def test_no_seed_no_derive_errors(self, capsys, monkeypatch):
        monkeypatch.setattr(sys, "argv", ["keygrain", "totp"])
        with pytest.raises(SystemExit):
            main()
        assert "Error" in capsys.readouterr().err


class TestTOTPModelB:
    """Model B: derived seed via --derive flag."""

    def test_derive_mode(self, capsys, monkeypatch):
        monkeypatch.setenv("KEYGRAIN_SECRET", "my-master-secret")
        monkeypatch.setattr(sys, "argv", [
            "keygrain", "totp", "--derive", "--email", "test@gmail.com", "--site", "github.com"
        ])
        with patch("keygrain.cli.time") as mock_time:
            mock_time.time.return_value = FIXED_TIME
            main()
        out = capsys.readouterr().out.strip()
        seed = derive_totp_seed(b"my-master-secret", "test@gmail.com", normalize_site("github.com"))
        expected = generate_totp(seed, FIXED_TIME, digits=6, period=30)
        assert out == expected

    def test_derive_missing_email(self, capsys, monkeypatch):
        monkeypatch.setenv("KEYGRAIN_SECRET", "my-master-secret")
        monkeypatch.setattr(sys, "argv", ["keygrain", "totp", "--derive", "--site", "github.com"])
        with pytest.raises(SystemExit):
            main()
        assert "--email" in capsys.readouterr().err

    def test_derive_missing_site(self, capsys, monkeypatch):
        monkeypatch.setenv("KEYGRAIN_SECRET", "my-master-secret")
        monkeypatch.setattr(sys, "argv", ["keygrain", "totp", "--derive", "--email", "test@gmail.com"])
        with pytest.raises(SystemExit):
            main()
        assert "--site" in capsys.readouterr().err

    def test_derive_missing_secret(self, capsys, monkeypatch):
        monkeypatch.delenv("KEYGRAIN_SECRET", raising=False)
        monkeypatch.setattr(sys, "argv", [
            "keygrain", "totp", "--derive", "--email", "test@gmail.com", "--site", "github.com"
        ])
        with pytest.raises(SystemExit):
            main()
        assert "KEYGRAIN_SECRET" in capsys.readouterr().err
