"""Master-secret input resolution for the CLI (prompt / env / file).

The master secret is NEVER accepted as a raw ``--secret VALUE`` argument
(that would leak it via ``ps`` / ``/proc/<pid>/cmdline`` / shell history).
It is resolved, in order, from:

- ``--secret-file PATH``  — read once, strip a single trailing newline,
  non-fatal warning if the file is more permissive than ``0600``.
- ``--secret-env VAR``    — read from environment variable ``VAR``.
- interactive prompt      — hidden ``getpass`` input, only when stdin is a TTY.

Exactly one of ``--secret-env`` / ``--secret-file`` may be supplied; supplying
both is an error. When neither is supplied and stdin is not a TTY, resolution
fails (no silent source, no implicit ``.env`` loading).
"""

import getpass
import os
import stat
import sys


class SecretResolutionError(Exception):
    """Raised when the master secret cannot be resolved from the given sources."""


def resolve_secret(
    *,
    secret_env: str | None = None,
    secret_file: str | None = None,
    prompt: str = "Master secret: ",
) -> bytes:
    """Resolve the master secret as bytes.

    Args:
        secret_env: Name of an environment variable to read the secret from,
            or ``None`` if ``--secret-env`` was not supplied.
        secret_file: Path to a file containing the secret, or ``None`` if
            ``--secret-file`` was not supplied.
        prompt: Prompt string used for interactive (TTY) input.

    Returns:
        The master secret as ``bytes`` (UTF-8 for prompt/env; raw file bytes
        with a single trailing newline stripped for file input).

    Raises:
        SecretResolutionError: if both flags are supplied, the chosen source is
            empty/unreadable, or no source is available in a non-interactive
            context.
    """
    if secret_env is not None and secret_file is not None:
        raise SecretResolutionError(
            "Choose one secret source: --secret-env or --secret-file, not both."
        )

    if secret_file is not None:
        return _read_secret_file(secret_file)

    if secret_env is not None:
        value = os.environ.get(secret_env)
        if not value:
            raise SecretResolutionError(
                f"Environment variable {secret_env!r} is not set or is empty."
            )
        return value.encode("utf-8")

    # Neither flag supplied: interactive prompt only when stdin is a TTY.
    if not sys.stdin.isatty():
        raise SecretResolutionError(
            "No secret source in a non-interactive context. "
            "Use --secret-env VAR or --secret-file PATH."
        )
    try:
        entered = getpass.getpass(prompt, stream=sys.stderr)
    except (EOFError, KeyboardInterrupt) as exc:  # pragma: no cover - interactive
        raise SecretResolutionError("Secret entry cancelled.") from exc
    if not entered:
        raise SecretResolutionError("Empty secret.")
    return entered.encode("utf-8")


def _read_secret_file(path: str) -> bytes:
    """Read a secret from ``path``, stripping one trailing newline.

    Emits a non-fatal stderr warning if the file permissions are broader than
    ``0600``. Raises ``SecretResolutionError`` if the file is missing/unreadable
    or empty after stripping.
    """
    try:
        with open(path, "rb") as fh:
            data = bytearray(fh.read())
    except OSError as exc:
        raise SecretResolutionError(f"Cannot read secret file {path!r}: {exc}") from exc

    try:
        mode = stat.S_IMODE(os.stat(path).st_mode)
        # Broader than 0600 = any permission bit set beyond owner read/write.
        if mode & ~0o600:
            print(
                f"Warning: secret file {path!r} has permissions {oct(mode)} "
                "(broader than 0600); consider `chmod 600`.",
                file=sys.stderr,
            )
    except OSError:  # pragma: no cover - stat after successful open is unlikely to fail
        pass

    # Strip exactly one trailing newline (\n or \r\n), matching file conventions.
    if data.endswith(b"\r\n"):
        del data[-2:]
    elif data.endswith(b"\n"):
        del data[-1:]

    if not data:
        raise SecretResolutionError(f"Secret file {path!r} is empty.")

    result = bytes(data)
    # Best-effort zeroization of the intermediate buffer (Python cannot
    # guarantee no copies remain; documented limitation).
    for i in range(len(data)):
        data[i] = 0
    return result
