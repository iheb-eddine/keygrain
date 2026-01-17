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
        with pytest.raises(ValueError, match="must be 32 bytes"):
            entropy_to_mnemonic(bytes(16))
        with pytest.raises(ValueError, match="must be 32 bytes"):
            entropy_to_mnemonic(bytes(33))

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
                v["email"],
                wallet_name=v["wallet_name"],
                chain=v["chain"],
                counter=v["counter"],
            )
            assert entropy.hex() == v["entropy_hex"], f"Vector {v['id']} mismatch"

    def test_case_normalization(self, vectors):
        """Vector 5 must equal vector 1 (case normalization)."""
        v1 = vectors["derivation_vectors"][0]
        v5 = vectors["derivation_vectors"][4]
        e1 = derive_wallet_entropy(
            v1["secret"].encode(), v1["email"],
            wallet_name=v1["wallet_name"], chain=v1["chain"], counter=v1["counter"],
        )
        e5 = derive_wallet_entropy(
            v5["secret"].encode(), v5["email"],
            wallet_name=v5["wallet_name"], chain=v5["chain"], counter=v5["counter"],
        )
        assert e1 == e5

    def test_chain_isolation(self, vectors):
        """Different chains produce different entropy."""
        v1 = vectors["derivation_vectors"][0]  # bitcoin
        v2 = vectors["derivation_vectors"][1]  # ethereum
        assert v1["entropy_hex"] != v2["entropy_hex"]

    def test_counter_rotation(self, vectors):
        """Different counters produce different entropy."""
        v1 = vectors["derivation_vectors"][0]  # counter=1
        v3 = vectors["derivation_vectors"][2]  # counter=2
        assert v1["entropy_hex"] != v3["entropy_hex"]

    def test_wallet_name_change(self, vectors):
        """Different wallet names produce different entropy."""
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
        e1 = derive_wallet_entropy(b"s", "e@x.com", wallet_name="w", chain="bitcoin", counter=1)
        e2 = derive_wallet_entropy(b"s", "e@x.com", wallet_name="w", chain="bitcoin", counter=1)
        assert e1 == e2


# --- Input validation ---


class TestInputValidation:
    def test_empty_wallet_name(self):
        with pytest.raises(ValueError, match="wallet_name"):
            derive_wallet_entropy(b"s", "e@x.com", wallet_name="", chain="bitcoin", counter=1)

    def test_wallet_name_with_spaces(self):
        with pytest.raises(ValueError, match="wallet_name"):
            derive_wallet_entropy(b"s", "e@x.com", wallet_name="bad name", chain="bitcoin", counter=1)

    def test_wallet_name_with_colons(self):
        with pytest.raises(ValueError, match="wallet_name"):
            derive_wallet_entropy(b"s", "e@x.com", wallet_name="my:wallet", chain="bitcoin", counter=1)

    def test_wallet_name_with_underscores(self):
        with pytest.raises(ValueError, match="wallet_name"):
            derive_wallet_entropy(b"s", "e@x.com", wallet_name="my_wallet", chain="bitcoin", counter=1)

    def test_wallet_name_uppercase_accepted(self):
        """Uppercase input is lowercased then validated — should work."""
        e = derive_wallet_entropy(b"s", "e@x.com", wallet_name="MyWallet", chain="bitcoin", counter=1)
        assert len(e) == 32

    def test_invalid_chain(self):
        with pytest.raises(ValueError, match="Unsupported chain"):
            derive_wallet_entropy(b"s", "e@x.com", wallet_name="w", chain="bitconi", counter=1)

    def test_counter_zero(self):
        with pytest.raises(ValueError, match="counter"):
            derive_wallet_entropy(b"s", "e@x.com", wallet_name="w", chain="bitcoin", counter=0)

    def test_counter_negative(self):
        with pytest.raises(ValueError, match="counter"):
            derive_wallet_entropy(b"s", "e@x.com", wallet_name="w", chain="bitcoin", counter=-1)

    def test_empty_secret(self):
        with pytest.raises(ValueError, match="secret"):
            derive_wallet_entropy(b"", "e@x.com", wallet_name="w", chain="bitcoin", counter=1)

    def test_empty_email(self):
        with pytest.raises(ValueError, match="email"):
            derive_wallet_entropy(b"s", "", wallet_name="w", chain="bitcoin", counter=1)

    def test_valid_wallet_names(self):
        """Hyphens and digits are allowed."""
        for name in ["cold-storage", "wallet-1", "a", "123", "a-b-c"]:
            e = derive_wallet_entropy(b"s", "e@x.com", wallet_name=name, chain="bitcoin", counter=1)
            assert len(e) == 32


# --- Double-derivation ---


class TestDoubleDerivation:
    def test_derive_wallet_mnemonic_passes(self):
        """derive_wallet_mnemonic performs double-derivation internally."""
        mnemonic = derive_wallet_mnemonic(
            b"test-secret", "user@example.com",
            wallet_name="main", chain="ethereum", counter=1,
        )
        words = mnemonic.split()
        assert len(words) == 24
        _validate_mnemonic(mnemonic)

    def test_full_chain_matches_vectors(self, vectors):
        """derive_wallet_mnemonic produces same mnemonic as vectors."""
        v = vectors["derivation_vectors"][0]
        mnemonic = derive_wallet_mnemonic(
            v["secret"].encode(), v["email"],
            wallet_name=v["wallet_name"], chain=v["chain"], counter=v["counter"],
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
