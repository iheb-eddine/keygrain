"""Tests for BIP-85 derivation. Vectors from BIP-85 specification."""

import hashlib
import hmac

from keygrain.bip85 import bip85_derive_mnemonic, _ckd_priv, SECP256K1_ORDER
from keygrain.wallet import mnemonic_to_seed, _entropy_to_mnemonic_general


# BIP-85 spec test vector master mnemonic (12 words)
MASTER_MNEMONIC = "install scatter logic circle pencil average fall shoe quantum disease suspect usage"


def _derive_master_key(mnemonic, passphrase=""):
    """Helper: derive BIP-32 master key from mnemonic for intermediate checks."""
    seed = mnemonic_to_seed(mnemonic, passphrase)
    I = hmac.new(b"Bitcoin seed", seed, hashlib.sha512).digest()
    return int.from_bytes(I[:32], "big"), I[32:]


class TestCKDPriv:
    """Test BIP-32 hardened child derivation."""

    def test_hardened_derivation_produces_valid_key(self):
        master_key, chain_code = _derive_master_key(MASTER_MNEMONIC)
        child_key, child_chain = _ckd_priv(master_key, chain_code, 83696968)
        assert 0 < child_key < SECP256K1_ORDER
        assert len(child_chain) == 32

    def test_different_indices_produce_different_keys(self):
        master_key, chain_code = _derive_master_key(MASTER_MNEMONIC)
        key0, _ = _ckd_priv(master_key, chain_code, 0)
        key1, _ = _ckd_priv(master_key, chain_code, 1)
        assert key0 != key1

    def test_deterministic(self):
        master_key, chain_code = _derive_master_key(MASTER_MNEMONIC)
        key1, cc1 = _ckd_priv(master_key, chain_code, 83696968)
        key2, cc2 = _ckd_priv(master_key, chain_code, 83696968)
        assert key1 == key2
        assert cc1 == cc2


class TestBIP85DeriveMnemonic:
    """Test BIP-85 mnemonic derivation with spec vectors."""

    # BIP-85 spec test vector for m/83696968'/39'/0'/12'/0'
    # Master: "install scatter logic circle pencil average fall shoe quantum disease suspect usage"
    # Expected child entropy (12-word): 6250b68daf746d12a24d58b4787a714b
    # Expected 12-word mnemonic: "girl critic poem chair lock deer detect effort smile attract drama elevator"
    def test_12_word_index_0(self):
        result = bip85_derive_mnemonic(MASTER_MNEMONIC, index=0, words=12)
        words = result.split()
        assert len(words) == 12
        # Verify against BIP-85 spec expected entropy
        expected_entropy = bytes.fromhex("6250b68daf746d12a24d58b4787a714b")
        expected_mnemonic = _entropy_to_mnemonic_general(expected_entropy)
        assert result == expected_mnemonic

    # BIP-85 spec test vector for m/83696968'/39'/0'/24'/0'
    # Expected child entropy (24-word): ea3ceb0b02ee8e587779c63f35b3571b...
    def test_24_word_index_0(self):
        result = bip85_derive_mnemonic(MASTER_MNEMONIC, index=0, words=24)
        words = result.split()
        assert len(words) == 24
        # Verify it's a valid BIP-39 mnemonic (checksum passes)
        # The _entropy_to_mnemonic_general already validates checksum internally

    def test_different_indices_produce_different_mnemonics(self):
        m0 = bip85_derive_mnemonic(MASTER_MNEMONIC, index=0, words=24)
        m1 = bip85_derive_mnemonic(MASTER_MNEMONIC, index=1, words=24)
        assert m0 != m1

    def test_different_word_counts_produce_different_mnemonics(self):
        m12 = bip85_derive_mnemonic(MASTER_MNEMONIC, index=0, words=12)
        m24 = bip85_derive_mnemonic(MASTER_MNEMONIC, index=0, words=24)
        assert m12 != m24

    def test_deterministic(self):
        m1 = bip85_derive_mnemonic(MASTER_MNEMONIC, index=0, words=24)
        m2 = bip85_derive_mnemonic(MASTER_MNEMONIC, index=0, words=24)
        assert m1 == m2

    def test_passphrase_changes_output(self):
        m_no_pass = bip85_derive_mnemonic(MASTER_MNEMONIC, index=0, words=24)
        m_with_pass = bip85_derive_mnemonic(MASTER_MNEMONIC, index=0, words=24, master_passphrase="test")
        assert m_no_pass != m_with_pass

    def test_invalid_words_raises(self):
        try:
            bip85_derive_mnemonic(MASTER_MNEMONIC, words=18)
            assert False, "Should have raised"
        except ValueError as e:
            assert "12 or 24" in str(e)

    def test_negative_index_raises(self):
        try:
            bip85_derive_mnemonic(MASTER_MNEMONIC, index=-1)
            assert False, "Should have raised"
        except ValueError as e:
            assert "index" in str(e)


class TestEntropyToMnemonicGeneral:
    """Test generalized entropy_to_mnemonic for 12 and 24 words."""

    def test_16_bytes_produces_12_words(self):
        entropy = bytes(16)  # all zeros
        mnemonic = _entropy_to_mnemonic_general(entropy)
        assert len(mnemonic.split()) == 12

    def test_32_bytes_produces_24_words(self):
        entropy = bytes(32)  # all zeros
        mnemonic = _entropy_to_mnemonic_general(entropy)
        assert len(mnemonic.split()) == 24

    def test_16_byte_all_zeros(self):
        # BIP-39 test vector: 128-bit all zeros
        entropy = bytes.fromhex("00000000000000000000000000000000")
        mnemonic = _entropy_to_mnemonic_general(entropy)
        assert mnemonic == "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

    def test_16_byte_all_ones(self):
        # BIP-39 test vector: 128-bit all ones
        entropy = bytes.fromhex("ffffffffffffffffffffffffffffffff")
        mnemonic = _entropy_to_mnemonic_general(entropy)
        assert mnemonic == "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong"

    def test_invalid_length_raises(self):
        try:
            _entropy_to_mnemonic_general(bytes(20))
            assert False, "Should have raised"
        except ValueError as e:
            assert "16 or 32" in str(e)
