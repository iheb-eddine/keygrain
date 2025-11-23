"""CLI for keygrain password derivation."""

import argparse
import os
import sys

from .derive import derive_password, DEFAULT_SYMBOLS


def main():
    parser = argparse.ArgumentParser(description="Derive a deterministic password")
    parser.add_argument("email", help="Email address")
    parser.add_argument("--length", type=int, default=20, help="Password length (default: 20)")
    parser.add_argument("--symbols", default=DEFAULT_SYMBOLS, help="Symbol charset")
    parser.add_argument("--salt", default="", help="Optional salt")
    parser.add_argument("--secret-env", default="KEYGRAIN_SECRET", help="Env var holding the master secret")
    args = parser.parse_args()

    secret = os.environ.get(args.secret_env, "")
    if not secret:
        print(f"Error: Master secret not found. Set the {args.secret_env} environment variable.", file=sys.stderr)
        sys.exit(1)

    try:
        password = derive_password(
            secret.encode(), args.email, length=args.length, symbols=args.symbols, salt=args.salt
        )
    except ValueError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    print(password)


if __name__ == "__main__":
    main()
