"""CLI for keygrain password, SSH key, and wallet derivation."""

import argparse
import base64
import os
import subprocess
import sys
import time

from importlib.metadata import version as pkg_version, PackageNotFoundError

try:
    __version__ = pkg_version("keygrain")
except PackageNotFoundError:
    __version__ = "dev"

from .derive import derive_password, normalize_site, DEFAULT_SYMBOLS
from .ssh import derive_ssh_keypair, format_openssh_private_key, format_authorized_keys
from .wallet import (
    derive_wallet_entropy, derive_wallet_mnemonic, mnemonic_to_seed,
    SUPPORTED_CHAINS, BIP44_PATHS,
)
from .bip85 import bip85_derive_mnemonic
from .totp import generate_totp, parse_totp_input, derive_totp_seed
from . import cache as cache_mod
from . import sync_client
from . import selection
from .secret_input import resolve_secret, SecretResolutionError


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
    # --path doesn't need secret or confirmation
    if args.path:
        chain = args.chain.lower()
        if chain not in SUPPORTED_CHAINS:
            print(f"Error: Unsupported chain {chain!r}.", file=sys.stderr)
            sys.exit(1)
        print(BIP44_PATHS[chain])
        return

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


def _cmd_totp(args):
    if args.derive:
        if not args.email or not args.site:
            print("Error: --email and --site are required with --derive", file=sys.stderr)
            sys.exit(1)
        secret = _get_secret(args.secret_env)
        seed = derive_totp_seed(secret, args.email, normalize_site(args.site))
        digits = args.digits or 6
        period = args.period or 30
        algorithm = "SHA1"
    else:
        if not args.seed:
            print("Error: --seed is required (or use --derive with --email and --site)", file=sys.stderr)
            sys.exit(1)
        try:
            params = parse_totp_input(args.seed)
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        seed = params["seed"]
        digits = args.digits if args.digits is not None else params["digits"]
        period = args.period if args.period is not None else params["period"]
        algorithm = params.get("algorithm", "SHA1")

    try:
        code = generate_totp(seed, int(time.time()), digits=digits, period=period, algorithm=algorithm)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    print(code)


def _build_password_parser(parser):
    parser.add_argument("email", help="Email address")
    parser.add_argument("--site", required=True, help="Site identifier")
    parser.add_argument("--length", type=int, default=20, help="Password length (default: 20)")
    parser.add_argument("--symbols", default=DEFAULT_SYMBOLS, help="Symbol charset")
    parser.add_argument("--counter", type=int, default=1, help="Rotation counter (default: 1)")
    parser.add_argument("--secret-env", default="KEYGRAIN_SECRET", help="Env var holding the master secret")


# --- sync/list/get support (read-only cache) ---

_SECRET_HELP_ENV = (
    "Read secret from environment variable VAR (default: KEYGRAIN_SECRET when the "
    "flag is given without a value). Use for CI/CD with injected secrets "
    "(GitHub Actions, GitLab CI variables)."
)
_SECRET_HELP_FILE = (
    "Read secret from file PATH (strips one trailing newline; warns if perms > 0600). "
    "Use for Docker/Kubernetes secrets mounted as files "
    "(e.g. /run/secrets/keygrain_secret)."
)
_SECRET_EPILOG = (
    "Master secret sources (choose at most one of --secret-env / --secret-file):\n"
    "  --secret-env VAR    from an environment variable (CI/CD injected secrets)\n"
    "  --secret-file PATH  from a file (Docker/Kubernetes mounted secrets)\n"
    "  (no flag)           prompt securely with hidden input, when run interactively"
)


def _add_secret_args(parser):
    parser.add_argument(
        "--secret-env", nargs="?", const="KEYGRAIN_SECRET", default=None, metavar="VAR",
        help=_SECRET_HELP_ENV,
    )
    parser.add_argument("--secret-file", default=None, metavar="PATH", help=_SECRET_HELP_FILE)


def _resolve_secret_or_exit(args) -> bytes:
    try:
        return resolve_secret(secret_env=args.secret_env, secret_file=args.secret_file)
    except SecretResolutionError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def _resolve_account_or_exit(email):
    """Resolve the account email for list/get (requires an existing cache)."""
    try:
        account = cache_mod.resolve_account(email)
    except cache_mod.AmbiguousAccountError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    if account is None:
        print("Error: No local cache. Run `keygrain sync` first.", file=sys.stderr)
        sys.exit(1)
    return account


def _read_cache_or_exit(secret, account):
    try:
        return cache_mod.read_cache(secret, account)
    except cache_mod.CacheNotFoundError:
        print("Error: No local cache. Run `keygrain sync` first.", file=sys.stderr)
        sys.exit(1)
    except cache_mod.CacheError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def _relative_time(ts) -> str:
    if not isinstance(ts, (int, float)):
        return "unknown"
    delta = int(time.time()) - int(ts)
    if delta < 0:
        return "in the future"
    if delta < 60:
        return f"{delta}s ago"
    if delta < 3600:
        return f"{delta // 60}m ago"
    if delta < 86400:
        return f"{delta // 3600}h ago"
    return f"{delta // 86400}d ago"


def _format_date(ts) -> str:
    """Render a unix timestamp as a human-readable UTC date (YYYY-MM-DD).

    Returns ``-`` when the value is absent or not a usable number.
    """
    if not isinstance(ts, (int, float)) or isinstance(ts, bool):
        return "-"
    try:
        return time.strftime("%Y-%m-%d", time.gmtime(int(ts)))
    except (ValueError, OverflowError, OSError):
        return "-"


def _cmd_sync(args):
    # 1) Resolve the account email (needed for lock/slug) BEFORE anything else.
    try:
        account = cache_mod.resolve_account(args.email)
    except cache_mod.AmbiguousAccountError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    # --unlock is a standalone action.
    if args.unlock:
        acct = account or args.email
        if not acct:
            print("Error: Specify --email to unlock.", file=sys.stderr)
            sys.exit(1)
        if sys.stdin.isatty():
            try:
                resp = input(f"Remove sync lock for {acct}? [y/N] ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                resp = "n"
            if resp not in ("y", "yes"):
                print("Cancelled.", file=sys.stderr)
                sys.exit(3)
        removed = cache_mod.remove_lock(acct)
        print("Sync unlocked." if removed else "No lock was present.", file=sys.stderr)
        return

    if account is None:
        # First sync for a machine: an email is required.
        account = args.email
        if not account:
            if sys.stdin.isatty():
                try:
                    account = input("Account email: ").strip()
                except (EOFError, KeyboardInterrupt):
                    account = ""
            if not account:
                print("Error: Specify --email for the first sync.", file=sys.stderr)
                sys.exit(1)

    # 2) Lock gate — BEFORE any secret prompt or network access.
    if cache_mod.is_locked(account):
        print(
            "Error: Sync is locked for this account (offline-only). "
            "Run `keygrain sync --unlock` to re-enable.",
            file=sys.stderr,
        )
        sys.exit(1)

    # 3) Secret.
    secret = _resolve_secret_or_exit(args)

    # 4) Server URL: --server, else the (authenticated) URL inside the existing
    #    cache body, else the hardcoded default. Never from an unauthenticated source.
    server_url = args.server
    if not server_url:
        try:
            existing = cache_mod.read_cache(secret, account)
            server_url = existing.get("server_url") or sync_client.DEFAULT_SERVER_URL
        except cache_mod.CacheError:
            server_url = sync_client.DEFAULT_SERVER_URL

    # 5) Download (read-only GET).
    try:
        content = sync_client.download_sync_content(server_url, secret, account)
    except sync_client.NotFoundError:
        print(
            "No data on server for this account. Existing cache (if any) left untouched.",
            file=sys.stderr,
        )
        sys.exit(1)
    except sync_client.AuthError:
        print("Error: Authentication failed (check secret/email).", file=sys.stderr)
        sys.exit(1)
    except sync_client.RateLimitedError as e:
        hint = f" Retry after {e.retry_after}s." if e.retry_after else ""
        print(f"Error: Rate limited by server.{hint}", file=sys.stderr)
        sys.exit(1)
    except (sync_client.NetworkError, sync_client.ServerError,
            sync_client.ChecksumMismatchError, sync_client.BlobDecryptError,
            sync_client.SyncError) as e:
        print(f"Error: {e}", file=sys.stderr)
        if cache_mod.resolve_account(account) is not None:
            print("Existing cache left intact; offline `list`/`get` still work.", file=sys.stderr)
        sys.exit(1)

    # 6) Write cache (server_url stored INSIDE the encrypted body).
    cache_mod.write_cache(secret, account, content, server_url=server_url)
    print(f"Synced {len(content.get('services', []))} service(s) to local cache.", file=sys.stderr)

    # 7) Optional lock after a successful sync.
    if args.lock:
        cache_mod.create_lock(account)
        print("Sync locked (offline-only until --unlock).", file=sys.stderr)


def _cmd_list(args):
    account = _resolve_account_or_exit(args.email)
    secret = _resolve_secret_or_exit(args)
    data = _read_cache_or_exit(secret, account)

    services = data.get("services", [])
    filtered = selection.filter_services(
        services, site=args.site, service_email=args.service_email, type_=args.type
    )

    print(f"Account: {account}  |  last synced: {_relative_time(data.get('synced_at'))}",
          file=sys.stderr)
    if not filtered:
        print("(no matching services)", file=sys.stderr)
        return

    headers = ["NAME", "SITE", "EMAIL", "TYPES", "UPDATED", "ID"]
    rows = []
    for s in filtered:
        types = ",".join(selection.types_present(s))
        rows.append([
            s.get("name") or "-",
            s.get("site") or "-",
            s.get("email") or "-",
            types or "-",
            _format_date(s.get("updated_at")),
            s.get("id") or "-",
        ])

    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def _fmt(cells):
        return "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells)).rstrip()

    print(_fmt(headers))
    for row in rows:
        print(_fmt(row))


def _cmd_get(args):
    account = _resolve_account_or_exit(args.email)
    secret = _resolve_secret_or_exit(args)
    data = _read_cache_or_exit(secret, account)

    services = data.get("services", [])
    try:
        selected, siblings = selection.select_service(
            services, entry_id=args.id, site=args.site, service_email=args.service_email
        )
    except selection.NoMatchError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except selection.AmbiguousMatchError as e:
        print(f"Error: {e}", file=sys.stderr)
        for c in e.candidates:
            print("  - " + selection.format_candidate(c), file=sys.stderr)
        sys.exit(1)

    if siblings:
        print("Note: subdomain siblings also match (use --id to target them):", file=sys.stderr)
        for c in siblings:
            print("  - " + selection.format_candidate(c), file=sys.stderr)

    # ALWAYS echo the resolved target to stderr BEFORE printing any secret to stdout.
    print(f"Resolved: site={selected.get('site', '?')} "
          f"service-email={selected.get('email', '?')}", file=sys.stderr)

    svc_email = selected.get("email")
    if not svc_email:
        print("Error: Selected service has no email.", file=sys.stderr)
        sys.exit(1)

    if args.totp:
        _get_totp(selected, secret)
    elif args.ssh:
        _get_ssh(selected, secret, args)
    else:
        _get_password(selected, secret)


def _get_password(service, secret):
    try:
        password = derive_password(
            secret, service["email"], site=normalize_site(service.get("site", "")),
            length=service.get("length", 20),
            symbols=service.get("symbols") or DEFAULT_SYMBOLS,
            counter=service.get("counter", 1),
        )
    except ValueError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    print(password)


def _get_totp(service, secret):
    totp = service.get("totp")
    if not totp:
        print("Error: Selected service has no TOTP configuration.", file=sys.stderr)
        sys.exit(1)
    mode = totp.get("mode")
    try:
        if mode == "stored":
            seed = base64.b64decode(totp["seed"])
        elif mode == "derived":
            seed = derive_totp_seed(secret, service["email"], service.get("site", ""))
        else:
            print(f"Error: Unknown TOTP mode: {mode!r}.", file=sys.stderr)
            sys.exit(1)
        code = generate_totp(
            seed, int(time.time()),
            digits=totp.get("digits", 6) or 6,
            period=totp.get("period", 30) or 30,
            algorithm=totp.get("algorithm", "SHA1") or "SHA1",
        )
    except (ValueError, KeyError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    print(code)


def _get_ssh(service, secret, args):
    ssh = service.get("ssh")
    if not ssh or not ssh.get("key_name"):
        print("Error: Selected service has no SSH key configuration.", file=sys.stderr)
        sys.exit(1)
    key_name = ssh["key_name"]
    counter = ssh.get("counter", 1) or 1
    try:
        seed, pubkey = derive_ssh_keypair(secret, service["email"], key_name=key_name, counter=counter)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    comment = f"{service['email'].lower()}:{key_name.lower()}"
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
        sys.stdout.write(format_openssh_private_key(seed, pubkey, comment))
    else:
        print(format_authorized_keys(pubkey, comment))


_TOP_LEVEL_HELP = """\
keygrain — deterministic password, SSH key, TOTP seed, and HD wallet derivation.

Usage:
  keygrain <email> --site <site> [options]   Derive a password (default bare form)
  keygrain <command> [options]

Commands:
  password        Derive a password (same as the default bare form above)
  sync            Download + cache the account's sync record (read-only; networked)
  list            List cached services (offline; no network)
  get             Retrieve one credential from the cache (offline; no network)
  ssh             Derive an SSH key
  wallet          Derive a wallet mnemonic
  totp            Generate a TOTP code
  wallet-bip85    Derive a child mnemonic via BIP-85

Run 'keygrain <command> --help' for command-specific options."""


def main():
    argv = sys.argv[1:]
    subcommands = {"ssh", "password", "wallet", "wallet-bip85", "totp", "sync", "list", "get"}
    first_positional = next((a for a in argv if not a.startswith("-")), None)
    help_requested = any(a in ("-h", "--help") for a in argv)
    has_site = any(a == "--site" or a.startswith("--site=") for a in argv)

    if first_positional not in subcommands:
        # No recognized subcommand. Decide between top-level help, the bare
        # default-password parser, and an honest unknown-command error.
        if first_positional is None:
            # Options-only (or empty) invocation.
            if help_requested or not argv:
                # `keygrain`, `keygrain --help`, `keygrain -h`
                print(_TOP_LEVEL_HELP)
                sys.exit(0)
            # else: fall through to the bare parser so `--version` works and
            # `--site x` (without an email) still errors as it does today.
        elif help_requested:
            # A non-subcommand positional plus -h/--help: list all commands.
            print(_TOP_LEVEL_HELP)
            sys.exit(0)
        elif not has_site:
            # An unrecognized/incomplete first token (e.g. `keygrain frobnicate`
            # or `keygrain me@x.com` with no --site). Show the command list
            # instead of the misleading `--site is required`.
            print(_TOP_LEVEL_HELP, file=sys.stderr)
            sys.exit(2)
        # Otherwise: a bare `keygrain <email> --site <site>` call — parse below.

    if first_positional in subcommands:
        parser = argparse.ArgumentParser(prog="keygrain", description="Deterministic password, SSH key, and wallet derivation")
        parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
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
        ssh_parser.add_argument("--secret-env", default="KEYGRAIN_SECRET", help="Env var holding the master secret")

        wallet_parser = subparsers.add_parser("wallet", help="Derive a wallet mnemonic")
        wallet_parser.add_argument("email", help="Email address")
        wallet_parser.add_argument("--name", required=True, help="Wallet name (e.g. personal, savings)")
        wallet_parser.add_argument("--chain", required=True, help=f"Chain ({', '.join(sorted(SUPPORTED_CHAINS))})")
        wallet_parser.add_argument("--counter", type=int, default=1, help="Rotation counter (default: 1)")
        wallet_parser.add_argument("--raw", action="store_true", help="Output raw 32-byte entropy as hex")
        wallet_parser.add_argument("--seed", action="store_true", help="Output 64-byte BIP-32 seed as hex")
        wallet_parser.add_argument("--path", action="store_true", help="Show BIP-44 derivation path")
        wallet_parser.add_argument("--yes-i-understand-the-risks", action="store_true", help="Skip interactive confirmation")
        wallet_parser.add_argument("--secret-env", default="KEYGRAIN_SECRET", help="Env var holding the master secret")

        bip85_parser = subparsers.add_parser("wallet-bip85", help="Derive child mnemonic via BIP-85")
        bip85_parser.add_argument("--mnemonic", required=True, help="Master BIP-39 mnemonic (12 or 24 words)")
        bip85_parser.add_argument("--index", type=int, default=0, help="Child index (default: 0)")
        bip85_parser.add_argument("--words", type=int, default=24, choices=[12, 24], help="Output word count (default: 24)")
        bip85_parser.add_argument("--passphrase", default="", help="BIP-39 passphrase for master mnemonic (default: empty)")

        totp_parser = subparsers.add_parser("totp", help="Generate a TOTP code")
        totp_parser.add_argument("--seed", help="TOTP seed (base32, hex, or otpauth:// URI)")
        totp_parser.add_argument("--site", help="Site identifier (for --derive mode)")
        totp_parser.add_argument("--email", help="Email address (for --derive mode)")
        totp_parser.add_argument("--derive", action="store_true", help="Derive seed from master secret + email + site")
        totp_parser.add_argument("--digits", type=int, default=None, choices=[6, 8], help="TOTP digits (default: 6)")
        totp_parser.add_argument("--period", type=int, default=None, help="TOTP period in seconds (default: 30)")
        totp_parser.add_argument("--secret-env", default="KEYGRAIN_SECRET", help="Env var holding the master secret")

        sync_parser = subparsers.add_parser(
            "sync", help="Download + cache the account's sync record (read-only)",
            epilog=_SECRET_EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter,
        )
        sync_parser.add_argument("--email", help="Account email (inferred if a single cache exists)")
        sync_parser.add_argument("--server", help="Sync server URL (default: https://keygrain.com)")
        _add_secret_args(sync_parser)
        lock_group = sync_parser.add_mutually_exclusive_group()
        lock_group.add_argument("--lock", action="store_true", help="Seal this account offline-only after syncing")
        lock_group.add_argument("--unlock", action="store_true", help="Remove the offline-only lock")

        list_parser = subparsers.add_parser(
            "list", help="List cached services (offline; no network)",
            epilog=_SECRET_EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter,
        )
        list_parser.add_argument("--email", help="Account email (inferred if a single cache exists)")
        list_parser.add_argument("--site", help="Filter by site (label-suffix match)")
        list_parser.add_argument("--service-email", help="Filter by service email")
        list_parser.add_argument("--type", choices=["password", "totp", "ssh"], help="Filter by credential type")
        _add_secret_args(list_parser)

        get_parser = subparsers.add_parser(
            "get", help="Retrieve one credential from the cache (offline; no network)",
            epilog=_SECRET_EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter,
        )
        get_parser.add_argument("--email", help="Account email (inferred if a single cache exists)")
        sel_group = get_parser.add_mutually_exclusive_group(required=True)
        sel_group.add_argument("--id", help="Select by exact service id (UUID)")
        sel_group.add_argument("--site", help="Select by site (label-suffix match)")
        get_parser.add_argument("--service-email", help="Narrow a --site match by service email")
        out_group = get_parser.add_mutually_exclusive_group()
        out_group.add_argument("--totp", action="store_true", help="Output the current TOTP code")
        out_group.add_argument("--ssh", action="store_true", help="Output the SSH key (authorized_keys by default)")
        get_parser.add_argument("--private", action="store_true", help="With --ssh: output the OpenSSH private key")
        get_parser.add_argument("--agent", action="store_true", help="With --ssh: add the key to ssh-agent")
        _add_secret_args(get_parser)

        args = parser.parse_args()
    else:
        parser = argparse.ArgumentParser(prog="keygrain", description="Derive a deterministic password")
        parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
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
    elif args.command == "totp":
        _cmd_totp(args)
    elif args.command == "sync":
        _cmd_sync(args)
    elif args.command == "list":
        _cmd_list(args)
    elif args.command == "get":
        _cmd_get(args)


if __name__ == "__main__":
    main()
