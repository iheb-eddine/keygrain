"""HD wallet derivation. See designs/hd-wallet-derivation.md."""

import hashlib
import hmac
import re

from .derive import strengthen_secret
from ._wordlist import WORDLIST, WORDLIST_SHA256

SUPPORTED_CHAINS: set[str] = {
    "bitcoin", "ethereum", "solana", "litecoin", "dogecoin",
    "bitcoin-testnet", "polkadot", "cosmos", "avalanche",
}

BIP44_PATHS: dict[str, str] = {
    "bitcoin": "m/84'/0'/0'/0/0",
    "ethereum": "m/44'/60'/0'/0/0",
    "solana": "m/44'/501'/0'/0'",
    "litecoin": "m/84'/2'/0'/0/0",
    "dogecoin": "m/44'/3'/0'/0/0",
    "bitcoin-testnet": "m/84'/1'/0'/0/0",
    "polkadot": "(substrate derivation)",
    "cosmos": "m/44'/118'/0'/0/0",
    "avalanche": "m/44'/60'/0'/0/0",
}

_WALLET_NAME_RE = re.compile(r"^[a-z0-9\-]+$")


def _verify_wordlist() -> None:
    raw = "\n".join(WORDLIST) + "\n"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    if digest != WORDLIST_SHA256:
        raise RuntimeError("BIP-39 wordlist integrity check failed")


_verify_wordlist()


def derive_wallet_entropy(
    secret: bytes,
    email: str,
    *,
    wallet_name: str,
    chain: str,
    counter: int = 1,
) -> bytes:
    """Derive 32 bytes of wallet entropy deterministically."""
    if not secret:
        raise ValueError("secret must not be empty")
    if not email:
        raise ValueError("email must not be empty")
    wallet_name = wallet_name.lower()
    if not wallet_name or not _WALLET_NAME_RE.match(wallet_name):
        raise ValueError(
            f"wallet_name must match [a-z0-9\\-]+, got: {wallet_name!r}"
        )
    chain = chain.lower()
    if chain not in SUPPORTED_CHAINS:
        raise ValueError(
            f"Unsupported chain {chain!r}. Supported: {sorted(SUPPORTED_CHAINS)}"
        )
    if counter < 1:
        raise ValueError("counter must be >= 1")

    email = email.lower()
    strengthened = strengthen_secret(secret, email)
    message = f"{email}:{wallet_name}:{chain}:{counter}:keygrain-wallet".encode("utf-8")
    return hmac.new(strengthened, message, hashlib.sha256).digest()


def entropy_to_mnemonic(entropy: bytes) -> str:
    """Convert 32 bytes of entropy to a 24-word BIP-39 mnemonic."""
    if len(entropy) != 32:
        raise ValueError(f"entropy must be 32 bytes, got {len(entropy)}")
    return _entropy_to_mnemonic_general(entropy)


def _entropy_to_mnemonic_general(entropy: bytes) -> str:
    """Convert 16 or 32 bytes of entropy to a 12 or 24-word BIP-39 mnemonic."""
    nbytes = len(entropy)
    if nbytes not in (16, 32):
        raise ValueError(f"entropy must be 16 or 32 bytes, got {nbytes}")

    # Checksum: CS = entropy_bits / 32 = nbytes * 8 / 32 = nbytes / 4 bits
    cs_bits = nbytes // 4  # 4 bits for 16 bytes, 8 bits for 32 bytes
    checksum_byte = hashlib.sha256(entropy).digest()[0]
    checksum = checksum_byte >> (8 - cs_bits)  # top cs_bits of first SHA256 byte

    # Total bits: entropy_bits + cs_bits
    entropy_int = int.from_bytes(entropy, "big")
    bits = (entropy_int << cs_bits) | checksum

    num_words = (nbytes * 8 + cs_bits) // 11  # 12 or 24
    words = []
    for i in range(num_words - 1, -1, -1):
        index = (bits >> (i * 11)) & 0x7FF
        words.append(WORDLIST[index])

    mnemonic = " ".join(words)
    _validate_mnemonic(mnemonic)
    return mnemonic


def _validate_mnemonic(mnemonic: str) -> None:
    """Validate a 12 or 24-word BIP-39 mnemonic checksum."""
    words = mnemonic.split()
    if len(words) not in (12, 24):
        raise ValueError(f"mnemonic must be 12 or 24 words, got {len(words)}")
    indices = []
    for w in words:
        if w not in WORDLIST:
            raise ValueError(f"word {w!r} not in BIP-39 wordlist")
        indices.append(WORDLIST.index(w))
    # Reconstruct bits
    bits = 0
    for idx in indices:
        bits = (bits << 11) | idx
    # Split: entropy_bits = len(words) * 11 - cs_bits, cs_bits = entropy_bits / 32
    # For 12 words: 132 total bits, 128 entropy, 4 checksum
    # For 24 words: 264 total bits, 256 entropy, 8 checksum
    num_words = len(words)
    cs_bits = num_words // 3  # 4 for 12 words, 8 for 24 words
    entropy_bits = num_words * 11 - cs_bits
    nbytes = entropy_bits // 8

    checksum_got = bits & ((1 << cs_bits) - 1)
    entropy_int = bits >> cs_bits
    entropy_bytes = entropy_int.to_bytes(nbytes, "big")
    checksum_expected = hashlib.sha256(entropy_bytes).digest()[0] >> (8 - cs_bits)
    if checksum_got != checksum_expected:
        raise ValueError("BIP-39 checksum mismatch")


def mnemonic_to_seed(mnemonic: str, passphrase: str = "") -> bytes:
    """Convert a BIP-39 mnemonic to a 64-byte BIP-32 seed via PBKDF2-SHA512."""
    password = mnemonic.encode("utf-8")
    salt = ("mnemonic" + passphrase).encode("utf-8")
    return hashlib.pbkdf2_hmac("sha512", password, salt, 2048, dklen=64)


def derive_wallet_mnemonic(
    secret: bytes,
    email: str,
    *,
    wallet_name: str,
    chain: str,
    counter: int = 1,
) -> str:
    """High-level: derive a 24-word BIP-39 mnemonic with double-derivation check."""
    entropy1 = derive_wallet_entropy(
        secret, email, wallet_name=wallet_name, chain=chain, counter=counter
    )
    entropy2 = derive_wallet_entropy(
        secret, email, wallet_name=wallet_name, chain=chain, counter=counter
    )
    if entropy1 != entropy2:
        raise RuntimeError(
            "CRITICAL: Double-derivation mismatch. Possible implementation bug or hardware fault."
        )
    return entropy_to_mnemonic(entropy1)
