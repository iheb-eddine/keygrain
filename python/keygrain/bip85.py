"""BIP-85 deterministic entropy from BIP-32 keychains. See designs/hd-wallet-derivation.md §11."""

import hashlib
import hmac

from .wallet import _entropy_to_mnemonic_general, mnemonic_to_seed

SECP256K1_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141


def _ckd_priv(key_int: int, chain_code: bytes, index: int) -> tuple[int, bytes]:
    """BIP-32 hardened child key derivation (CKDpriv)."""
    data = b"\x00" + key_int.to_bytes(32, "big") + (index | 0x80000000).to_bytes(4, "big")
    I = hmac.new(chain_code, data, hashlib.sha512).digest()
    IL, IR = I[:32], I[32:]
    IL_int = int.from_bytes(IL, "big")
    if IL_int >= SECP256K1_ORDER:
        raise ValueError("Invalid child key (IL >= n)")
    child_key = (IL_int + key_int) % SECP256K1_ORDER
    if child_key == 0:
        raise ValueError("Invalid child key (zero)")
    return child_key, IR


def bip85_derive_mnemonic(
    master_mnemonic: str,
    *,
    index: int = 0,
    words: int = 24,
    master_passphrase: str = "",
) -> str:
    """Derive a child mnemonic from a master mnemonic using BIP-85.

    Args:
        master_mnemonic: 12 or 24-word BIP-39 mnemonic.
        index: Child index (0-based, default 0).
        words: Number of words in output (12 or 24, default 24).
        master_passphrase: BIP-39 passphrase for the master mnemonic (default empty).

    Returns:
        Space-separated child mnemonic.

    Raises:
        ValueError: If words is not 12 or 24, or index < 0.
    """
    if words not in (12, 24):
        raise ValueError(f"words must be 12 or 24, got {words}")
    if index < 0:
        raise ValueError(f"index must be >= 0, got {index}")

    # Step 1: Master mnemonic → BIP-32 seed
    seed = mnemonic_to_seed(master_mnemonic, master_passphrase)

    # Step 2: BIP-32 master key
    I = hmac.new(b"Bitcoin seed", seed, hashlib.sha512).digest()
    master_key = int.from_bytes(I[:32], "big")
    master_chain_code = I[32:]

    if master_key == 0 or master_key >= SECP256K1_ORDER:
        raise ValueError("Invalid master key")

    # Step 3: Derive path m/83696968'/39'/0'/words'/index'
    key, chain_code = master_key, master_chain_code
    for child_index in [83696968, 39, 0, words, index]:
        key, chain_code = _ckd_priv(key, chain_code, child_index)

    # Step 4: BIP-85 entropy
    entropy_raw = hmac.new(b"bip-entropy-from-k", key.to_bytes(32, "big"), hashlib.sha512).digest()

    # Step 5: Truncate
    entropy_bytes = 16 if words == 12 else 32
    entropy = entropy_raw[:entropy_bytes]

    # Step 6: Convert to mnemonic
    return _entropy_to_mnemonic_general(entropy)
