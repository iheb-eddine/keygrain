"""Tests for TOTP generation, parsing, and derivation."""

import pytest
from keygrain.totp import generate_totp, parse_totp_input, derive_totp_seed


# RFC 6238 Appendix B test vectors
# Seeds: SHA1=20 bytes, SHA256=32 bytes, SHA512=64 bytes (ASCII "1234567890..." repeated)
SEED_SHA1 = b"12345678901234567890"
SEED_SHA256 = b"12345678901234567890123456789012"
SEED_SHA512 = b"1234567890123456789012345678901234567890123456789012345678901234"

RFC_VECTORS = [
    (59, "SHA1", SEED_SHA1, "94287082"),
    (59, "SHA256", SEED_SHA256, "46119246"),
    (59, "SHA512", SEED_SHA512, "90693936"),
    (1111111109, "SHA1", SEED_SHA1, "07081804"),
    (1111111109, "SHA256", SEED_SHA256, "68084774"),
    (1111111109, "SHA512", SEED_SHA512, "25091201"),
    (1111111111, "SHA1", SEED_SHA1, "14050471"),
    (1111111111, "SHA256", SEED_SHA256, "67062674"),
    (1111111111, "SHA512", SEED_SHA512, "99943326"),
    (1234567890, "SHA1", SEED_SHA1, "89005924"),
    (1234567890, "SHA256", SEED_SHA256, "91819424"),
    (1234567890, "SHA512", SEED_SHA512, "93441116"),
    (2000000000, "SHA1", SEED_SHA1, "69279037"),
    (2000000000, "SHA256", SEED_SHA256, "90698825"),
    (2000000000, "SHA512", SEED_SHA512, "38618901"),
    (20000000000, "SHA1", SEED_SHA1, "65353130"),
    (20000000000, "SHA256", SEED_SHA256, "77737706"),
    (20000000000, "SHA512", SEED_SHA512, "47863826"),
]


@pytest.mark.parametrize("time,algo,seed,expected", RFC_VECTORS)
def test_rfc6238_vectors(time, algo, seed, expected):
    result = generate_totp(seed, time, digits=8, period=30, algorithm=algo)
    assert result == expected


# Parsing tests
class TestParseTOTPInput:
    def test_otpauth_basic(self):
        r = parse_totp_input("otpauth://totp/GitHub:user@ex.com?secret=JBSWY3DPEHPK3PXP&digits=6&period=30")
        assert r["seed"] == bytes.fromhex("48656c6c6f21deadbeef")
        assert r["digits"] == 6
        assert r["period"] == 30
        assert r["algorithm"] == "SHA1"

    def test_otpauth_defaults(self):
        r = parse_totp_input("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP")
        assert r["digits"] == 6
        assert r["period"] == 30
        assert r["algorithm"] == "SHA1"

    def test_otpauth_sha256_8digits(self):
        r = parse_totp_input("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60")
        assert r["digits"] == 8
        assert r["period"] == 60
        assert r["algorithm"] == "SHA256"

    def test_otpauth_invalid_digits(self):
        with pytest.raises(ValueError):
            parse_totp_input("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=7")

    def test_otpauth_hotp_rejected(self):
        with pytest.raises(ValueError, match="HOTP|TOTP"):
            parse_totp_input("otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&counter=0")

    def test_otpauth_invalid_base32(self):
        with pytest.raises(ValueError):
            parse_totp_input("otpauth://totp/Test?secret=!!!INVALID!!!")

    def test_raw_base32(self):
        r = parse_totp_input("JBSWY3DPEHPK3PXP")
        assert r["seed"] == bytes.fromhex("48656c6c6f21deadbeef")
        assert r["digits"] == 6

    def test_raw_hex(self):
        r = parse_totp_input("48656c6c6f21deadbeef")
        assert r["seed"] == bytes.fromhex("48656c6c6f21deadbeef")

    def test_ambiguous_all_base32_chars(self):
        # ABCDEF234567ABCDEF23 — all chars valid base32, parsed as base32
        r = parse_totp_input("ABCDEF234567ABCDEF23")
        assert r["seed"] == bytes.fromhex("004432175be77df004432175")

    def test_lowercase_forces_hex(self):
        # abcdef234567abcdef23 — lowercase a-f forces hex
        r = parse_totp_input("abcdef234567abcdef23")
        assert r["seed"] == bytes.fromhex("abcdef234567abcdef23")

    def test_empty_rejected(self):
        with pytest.raises(ValueError):
            parse_totp_input("")


# Derivation tests
class TestDeriveTOTPSeed:
    def test_basic_derivation(self):
        seed = derive_totp_seed(b"my-master-secret", "test@gmail.com", "github.com")
        assert len(seed) == 32
        assert isinstance(seed, bytes)

    def test_site_case_insensitive(self):
        s1 = derive_totp_seed(b"my-master-secret", "test@gmail.com", "github.com")
        s2 = derive_totp_seed(b"my-master-secret", "test@gmail.com", "GitHub.com")
        assert s1 == s2

    def test_email_case_insensitive(self):
        s1 = derive_totp_seed(b"my-master-secret", "test@gmail.com", "github.com")
        s2 = derive_totp_seed(b"my-master-secret", "TEST@Gmail.com", "github.com")
        assert s1 == s2

    def test_different_secret_different_seed(self):
        s1 = derive_totp_seed(b"my-master-secret", "test@gmail.com", "github.com")
        s2 = derive_totp_seed(b"different-secret", "test@gmail.com", "github.com")
        assert s1 != s2

    def test_different_site_different_seed(self):
        s1 = derive_totp_seed(b"my-master-secret", "test@gmail.com", "github.com")
        s2 = derive_totp_seed(b"my-master-secret", "test@gmail.com", "google.com")
        assert s1 != s2
