"""CLI for keygrain password, SSH key, and wallet derivation."""

import argparse
import os
import subprocess
import sys

from .derive import derive_password, normalize_site, DEFAULT_SYMBOLS
from .ssh import derive_ssh_keypair, format_openssh_private_key, format_authorized_keys
from .wallet import (
    derive_wallet_entropy, derive_wallet_mnemonic, mnemonic_to_seed,
    SUPPORTED_CHAINS, BIP44_PATHS,
)
from .bip85 import bip85_derive_mnemonic


def _get_secret(env_var: str) -> bytes:
    secret = os.environ.get(env_var, "")
    if not secret:
        print(f"Error: Master secret not found. Set the {env_var} environment variable.", file=sys.stderr)
        sys.exit(1)
    return secret.encode()


def _cmd_password(args):
    secret = _get_secret(args.secret_env)
    try:
        password = derive_password(
            secret, args.email, site=normalize_site(args.site), length=args.length,
            symbols=args.symbols, counter=args.counter
        )
    except ValueError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    print(password)


def _cmd_ssh(args):
    secret = _get_secret(args.secret_env)
    try:
        seed, pubkey = derive_ssh_keypair(
            secret, args.email, key_name=args.name, counter=args.counter
        )
    except ValueError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    comment = f"{args.email.lower()}:{args.name.lower()}"

    if args.agent:
        sock = os.environ.get("SSH_AUTH_SOCK", "")
        if not sock or not os.path.exists(sock):
            print("Error: ssh-agent not available. Start one with: eval $(ssh-agent)", file=sys.stderr)
            sys.exit(2)
        pem = format_openssh_private_key(seed, pubkey, comment)
        proc = subprocess.run(["ssh-add", "-"], input=pem.encode(), capture_output=True)
        if proc.returncode != 0:
            print(f"Error: ssh-add failed: {proc.stderr.decode().strip()}", file=sys.stderr)
            sys.exit(2)
        print(proc.stderr.decode().strip() or f"Identity added: (stdin) ({comment})")
    elif args.private:
        pem = format_openssh_private_key(seed, pubkey, comment)
        sys.stdout.write(pem)
    else:
        print(format_authorized_keys(pubkey, comment))


def _cmd_wallet(args):
    secret = _get_secret(args.secret_env)

    # Interactive confirmation unless bypassed
    if not args.yes_i_understand_the_risks:
        print("\n\u26a0\ufe0f  WARNING: DISASTER RECOVERY ONLY", file=sys.stderr)
        print("\u26a0\ufe0f  If you lose your master secret, these funds are PERMANENTLY LOST.", file=sys.stderr)
        print("\u26a0\ufe0f  Do NOT use this as your only wallet backup.\n", file=sys.stderr)
        try:
            response = input('Type "I understand the risks" to continue: ')
        except (EOFError, KeyboardInterrupt):
            print("\nCancelled.", file=sys.stderr)
            sys.exit(3)
        if response != "I understand the risks":
            print("Cancelled.", file=sys.stderr)
            sys.exit(3)

    try:
        if args.raw:
            entropy = derive_wallet_entropy(
                secret, args.email, wallet_name=args.name, chain=args.chain, counter=args.counter
            )
            # Double-derivation check
            entropy2 = derive_wallet_entropy(
                secret, args.email, wallet_name=args.name, chain=args.chain, counter=args.counter
            )
            if entropy != entropy2:
                print("CRITICAL: Double-derivation mismatch.", file=sys.stderr)
                sys.exit(2)
            print(entropy.hex())
        elif args.seed:
            mnemonic = derive_wallet_mnemonic(
                secret, args.email, wallet_name=args.name, chain=args.chain, counter=args.counter
            )
            seed = mnemonic_to_seed(mnemonic)
            print(seed.hex())
        elif args.path:
            chain = args.chain.lower()
            if chain not in SUPPORTED_CHAINS:
                print(f"Error: Unsupported chain {chain!r}.", file=sys.stderr)
                sys.exit(1)
            print(BIP44_PATHS[chain])
        else:
            mnemonic = derive_wallet_mnemonic(
                secret, args.email, wallet_name=args.name, chain=args.chain, counter=args.counter
            )
            _display_mnemonic(mnemonic, args.chain.lower(), args.name.lower(), args.counter)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except RuntimeError as e:
        print(f"CRITICAL: {e}", file=sys.stderr)
        sys.exit(2)


def _display_mnemonic(mnemonic: str, chain: str, wallet_name: str, counter: int):
    words = mnemonic.split()
    print(f"\nVerification: \u2713 (double-derivation match)")
    print(f"\nChain:        {chain}")
    print(f"Wallet:       {wallet_name}")
    print(f"Counter:      {counter}")
    print(f"BIP-44 Path:  {BIP44_PATHS[chain]}")
    print(f"\nMnemonic (24 words):")
    print("\u250c" + "\u2500" * 55 + "\u2510")
    for row in range(6):
        col1 = f"{row+1:2d}. {words[row]:<12}"
        col2 = f"{row+7:2d}. {words[row+6]:<12}"
        col3 = f"{row+13:2d}. {words[row+12]:<12}"
        col4 = f"{row+19:2d}. {words[row+18]:<10}"
        print(f"\u2502 {col1}{col2}{col3}{col4} \u2502")
    print("\u2514" + "\u2500" * 55 + "\u2518")
    print("\nImport this mnemonic into your wallet software to verify addresses.")
    print("This mnemonic was NOT stored anywhere.")


def _cmd_wallet_bip85(args):
    try:
        mnemonic = bip85_derive_mnemonic(
            args.mnemonic, index=args.index, words=args.words, master_passphrase=args.passphrase
        )
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    path = f"m/83696968'/39'/0'/{args.words}'/{args.index}'"
    print(f"\n\u26a0\ufe0f  BIP-85 DERIVATION")
    print(f"Path: {path}")
    words = mnemonic.split()
    print(f"\nChild Mnemonic ({len(words)} words):")
    print(" ".join(words))


def _build_password_parser(parser):
    parser.add_argument("email", help="Email address")
    parser.add_argument("--site", required=True, help="Site identifier")
    parser.add_argument("--length", type=int, default=20, help="Password length (default: 20)")
    parser.add_argument("--symbols", default=DEFAULT_SYMBOLS, help="Symbol charset")
    parser.add_argument("--counter", type=int, default=1, help="Rotation counter (default: 1)")
    parser.add_argument("--secret-env", default="KEYGRAIN_SECRET", help="Env var holding the master secret")


def main():
    argv = sys.argv[1:]
    subcommands = {"ssh", "password", "wallet", "wallet-bip85"}
    first_positional = next((a for a in argv if not a.startswith("-")), None)

    if first_positional in subcommands:
        parser = argparse.ArgumentParser(prog="keygrain", description="Deterministic password, SSH key, and wallet derivation")
        parser.add_argument("--secret-env", default="KEYGRAIN_SECRET", help="Env var holding the master secret")
        subparsers = parser.add_subparsers(dest="command")

        pw_parser = subparsers.add_parser("password", help="Derive a password")
        _build_password_parser(pw_parser)

        ssh_parser = subparsers.add_parser("ssh", help="Derive an SSH key")
        ssh_parser.add_argument("email", help="Email address")
        ssh_parser.add_argument("--name", required=True, help="Key name (e.g. github, work-servers)")
        ssh_parser.add_argument("--counter", type=int, default=1, help="Rotation counter (default: 1)")
        ssh_parser.add_argument("--private", action="store_true", help="Output private key (OpenSSH PEM)")
        ssh_parser.add_argument("--agent", action="store_true", help="Add key to ssh-agent")

        wallet_parser = subparsers.add_parser("wallet", help="Derive a wallet mnemonic")
        wallet_parser.add_argument("email", help="Email address")
        wallet_parser.add_argument("--name", required=True, help="Wallet name (e.g. personal, savings)")
        wallet_parser.add_argument("--chain", required=True, help=f"Chain ({', '.join(sorted(SUPPORTED_CHAINS))})")
        wallet_parser.add_argument("--counter", type=int, default=1, help="Rotation counter (default: 1)")
        wallet_parser.add_argument("--raw", action="store_true", help="Output raw 32-byte entropy as hex")
        wallet_parser.add_argument("--seed", action="store_true", help="Output 64-byte BIP-32 seed as hex")
        wallet_parser.add_argument("--path", action="store_true", help="Show BIP-44 derivation path")
        wallet_parser.add_argument("--yes-i-understand-the-risks", action="store_true", help="Skip interactive confirmation")

        bip85_parser = subparsers.add_parser("wallet-bip85", help="Derive child mnemonic via BIP-85")
        bip85_parser.add_argument("--mnemonic", required=True, help="Master BIP-39 mnemonic (12 or 24 words)")
        bip85_parser.add_argument("--index", type=int, default=0, help="Child index (default: 0)")
        bip85_parser.add_argument("--words", type=int, default=24, choices=[12, 24], help="Output word count (default: 24)")
        bip85_parser.add_argument("--passphrase", default="", help="BIP-39 passphrase for master mnemonic (default: empty)")

        args = parser.parse_args()
    else:
        parser = argparse.ArgumentParser(prog="keygrain", description="Derive a deterministic password")
        _build_password_parser(parser)
        args = parser.parse_args()
        args.command = "password"

    if args.command == "password":
        _cmd_password(args)
    elif args.command == "ssh":
        _cmd_ssh(args)
    elif args.command == "wallet":
        _cmd_wallet(args)
    elif args.command == "wallet-bip85":
        _cmd_wallet_bip85(args)


if __name__ == "__main__":
    main()
