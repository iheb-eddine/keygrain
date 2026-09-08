"""Tests for HD wallet derivation."""

import json
import hashlib
from pathlib import Path

import pytest

from keygrain.wallet import (
    SUPPORTED_CHAINS,
    BIP44_PATHS,
    derive_wallet_entropy,
    entropy_to_mnemonic,
    mnemonic_to_seed,
    derive_wallet_mnemonic,
    _validate_mnemonic,
)


VECTORS_PATH = Path(__file__).parent.parent.parent / "wallet-vectors.json"


@pytest.fixture(scope="module")
def vectors():
    with open(VECTORS_PATH) as f:
        return json.load(f)


# --- BIP-39 known vectors ---


class TestEntropyToMnemonic:
    def test_all_zeros(self):
        entropy = bytes(32)
        mnemonic = entropy_to_mnemonic(entropy)
        words = mnemonic.split()
        assert len(words) == 24
        assert words == ["abandon"] * 23 + ["art"]

    def test_all_ones(self):
        entropy = bytes([0xFF] * 32)
        mnemonic = entropy_to_mnemonic(entropy)
        words = mnemonic.split()
        assert len(words) == 24
        assert words[:23] == ["zoo"] * 23
        assert words[23] == "vote"

    def test_7f_pattern(self):
        entropy = bytes([0x7F] * 32)
        mnemonic = entropy_to_mnemonic(entropy)
        words = mnemonic.split()
        assert len(words) == 24
        assert words[0] == "legal"
        assert words[1] == "winner"
        assert words[2] == "thank"
        assert words[3] == "year"

    def test_wrong_length_rejected(self):
        with pytest.raises(ValueError, match="must be 16 or 32 bytes"):
            entropy_to_mnemonic(bytes(15))
        with pytest.raises(ValueError, match="must be 16 or 32 bytes"):
            entropy_to_mnemonic(bytes(33))

    def test_16_bytes_entropy_12_words(self):
        entropy = bytes(16)
        mnemonic = entropy_to_mnemonic(entropy)
        words = mnemonic.split()
        assert len(words) == 12
        _validate_mnemonic(mnemonic)

    def test_checksum_valid(self, vectors):
        """All BIP-39 vectors produce valid checksums."""
        for v in vectors["bip39_vectors"]:
            entropy = bytes.fromhex(v["entropy_hex"])
            mnemonic = entropy_to_mnemonic(entropy)
            assert mnemonic == v["mnemonic"]
            _validate_mnemonic(mnemonic)  # Should not raise


# --- PBKDF2 seed derivation ---


class TestMnemonicToSeed:
    def test_bip39_trezor_vector(self, vectors):
        """BIP-39 test vector with passphrase 'TREZOR'."""
        v = vectors["pbkdf2_vectors"][0]
        seed = mnemonic_to_seed(v["mnemonic"], v["passphrase"])
        assert seed.hex() == v["seed_hex"]
        assert len(seed) == 64

    def test_empty_passphrase(self):
        mnemonic = entropy_to_mnemonic(bytes(32))
        seed = mnemonic_to_seed(mnemonic)
        assert len(seed) == 64
        # Verify it differs from TREZOR passphrase
        seed_trezor = mnemonic_to_seed(mnemonic, "TREZOR")
        assert seed != seed_trezor

    def test_seed_starts_with_expected(self, vectors):
        """PBKDF2 vector starts with c55257c360c07c72."""
        v = vectors["pbkdf2_vectors"][0]
        seed = mnemonic_to_seed(v["mnemonic"], v["passphrase"])
        assert seed.hex().startswith("c55257c360c07c72")


# --- Derivation vectors ---


class TestDeriveWalletEntropy:
    def test_vectors_match(self, vectors):
        """All derivation vectors produce expected entropy."""
        for v in vectors["derivation_vectors"]:
            entropy = derive_wallet_entropy(
                v["secret"].encode(),
                wallet_id=v["wallet_id"],
                words=v.get("words", 24),
                counter=v["counter"],
            )
            assert entropy.hex() == v["entropy_hex"], f"Vector {v['id']} mismatch"

    def test_case_normalization(self, vectors):
        """Vector 5 must equal vector 1 (case normalization)."""
        v1 = vectors["derivation_vectors"][0]
        v5 = vectors["derivation_vectors"][4]
        e1 = derive_wallet_entropy(
            v1["secret"].encode(),
            wallet_id=v1["wallet_id"], words=v1["words"], counter=v1["counter"],
        )
        e5 = derive_wallet_entropy(
            v5["secret"].encode(),
            wallet_id=v5["wallet_id"], words=v5["words"], counter=v5["counter"],
        )
        assert e1 == e5

    def test_counter_rotation(self, vectors):
        """Different counters produce different entropy."""
        v1 = vectors["derivation_vectors"][0]  # counter=1
        v3 = vectors["derivation_vectors"][2]  # counter=2
        assert v1["entropy_hex"] != v3["entropy_hex"]

    def test_wallet_id_change(self, vectors):
        """Different wallet ids produce different entropy."""
        v1 = vectors["derivation_vectors"][0]  # personal
        v4 = vectors["derivation_vectors"][3]  # savings
        assert v1["entropy_hex"] != v4["entropy_hex"]

    def test_secret_change(self, vectors):
        """Different secrets produce different entropy."""
        v1 = vectors["derivation_vectors"][0]
        v6 = vectors["derivation_vectors"][5]
        assert v1["entropy_hex"] != v6["entropy_hex"]

    def test_deterministic(self):
        """Same inputs always produce same output."""
        e1 = derive_wallet_entropy(b"s", wallet_id="w", words=24, counter=1)
        e2 = derive_wallet_entropy(b"s", wallet_id="w", words=24, counter=1)
        assert e1 == e2


# --- Input validation ---


class TestInputValidation:
    def test_empty_wallet_id(self):
        with pytest.raises(ValueError, match="wallet_id"):
            derive_wallet_entropy(b"s", wallet_id="", words=24, counter=1)

    def test_wallet_id_with_spaces(self):
        with pytest.raises(ValueError, match="wallet_id"):
            derive_wallet_entropy(b"s", wallet_id="bad name", words=24, counter=1)

    def test_wallet_id_with_colons(self):
        with pytest.raises(ValueError, match="wallet_id"):
            derive_wallet_entropy(b"s", wallet_id="my:wallet", words=24, counter=1)

    def test_wallet_id_with_underscores(self):
        with pytest.raises(ValueError, match="wallet_id"):
            derive_wallet_entropy(b"s", wallet_id="my_wallet", words=24, counter=1)

    def test_wallet_id_uppercase_accepted(self):
        """Uppercase input is lowercased then validated — should work."""
        e = derive_wallet_entropy(b"s", wallet_id="MyWallet", words=24, counter=1)
        assert len(e) == 32

    def test_invalid_words(self):
        with pytest.raises(ValueError, match="words"):
            derive_wallet_entropy(b"s", wallet_id="w", words=18, counter=1)

    def test_counter_zero(self):
        with pytest.raises(ValueError, match="counter"):
            derive_wallet_entropy(b"s", wallet_id="w", words=24, counter=0)

    def test_counter_negative(self):
        with pytest.raises(ValueError, match="counter"):
            derive_wallet_entropy(b"s", wallet_id="w", words=24, counter=-1)

    def test_empty_secret(self):
        with pytest.raises(ValueError, match="secret"):
            derive_wallet_entropy(b"", wallet_id="w", words=24, counter=1)

    def test_valid_wallet_ids(self):
        """Hyphens and digits are allowed."""
        for name in ["cold-storage", "wallet-1", "a", "123", "a-b-c"]:
            e = derive_wallet_entropy(b"s", wallet_id=name, words=24, counter=1)
            assert len(e) == 32


# --- Double-derivation ---


class TestDoubleDerivation:
    def test_derive_wallet_mnemonic_passes(self):
        """derive_wallet_mnemonic performs double-derivation internally."""
        mnemonic = derive_wallet_mnemonic(
            b"test-secret",
            wallet_id="main", words=24, counter=1,
        )
        words = mnemonic.split()
        assert len(words) == 24
        _validate_mnemonic(mnemonic)

    def test_full_chain_matches_vectors(self, vectors):
        """derive_wallet_mnemonic produces same mnemonic as vectors."""
        v = vectors["derivation_vectors"][0]
        mnemonic = derive_wallet_mnemonic(
            v["secret"].encode(),
            wallet_id=v["wallet_id"], words=v["words"], counter=v["counter"],
        )
        assert mnemonic == v["mnemonic"]


# --- Seed derivation from vectors ---


class TestSeedDerivation:
    def test_seed_matches_vectors(self, vectors):
        """Full chain: entropy → mnemonic → seed matches vectors."""
        for v in vectors["derivation_vectors"]:
            entropy = bytes.fromhex(v["entropy_hex"])
            mnemonic = entropy_to_mnemonic(entropy)
            seed = mnemonic_to_seed(mnemonic)
            assert seed.hex() == v["seed_hex"], f"Vector {v['id']} seed mismatch"


# --- SUPPORTED_CHAINS and BIP44_PATHS ---


class TestConstants:
    def test_supported_chains_count(self):
        assert len(SUPPORTED_CHAINS) == 9

    def test_bip44_paths_covers_all_chains(self):
        assert set(BIP44_PATHS.keys()) == SUPPORTED_CHAINS

    def test_all_chains_lowercase(self):
        for chain in SUPPORTED_CHAINS:
            assert chain == chain.lower()
