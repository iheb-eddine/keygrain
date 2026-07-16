"""CLI integration tests for `sync` / `list` / `get` (U6)."""

import base64
import re

import pytest

from keygrain import cli, cache as cache_mod, sync_client
from keygrain.derive import derive_password, DEFAULT_SYMBOLS
from keygrain.totp import derive_totp_seed, generate_totp
from keygrain.ssh import derive_ssh_keypair, format_authorized_keys

SECRET = "my-master-secret"
EMAIL = "test@gmail.com"


@pytest.fixture
def home(tmp_path, monkeypatch):
    h = str(tmp_path / "kg")
    monkeypatch.setattr(cache_mod, "keygrain_home", lambda: h)
    monkeypatch.setenv("KG_SECRET", SECRET)
    return h


def run(monkeypatch, capsys, argv):
    monkeypatch.setattr("sys.argv", ["keygrain"] + argv)
    code = 0
    try:
        cli.main()
    except SystemExit as e:
        code = e.code or 0
    cap = capsys.readouterr()
    return code, cap.out, cap.err


def _content():
    return {
        "services": [
            {"name": "GitHub", "site": "github.com", "email": EMAIL, "length": 20,
             "symbols": DEFAULT_SYMBOLS, "counter": 1, "id": "uuid-gh", "updated_at": 100},
            {"name": "Sub", "site": "accounts.github.com", "email": EMAIL, "length": 20,
             "symbols": DEFAULT_SYMBOLS, "counter": 1, "id": "uuid-sub", "updated_at": 101},
            {"name": "TOTP", "site": "totp.example", "email": EMAIL, "id": "uuid-totp",
             "updated_at": 102, "totp": {"mode": "derived", "digits": 6, "period": 30, "algorithm": "SHA1"}},
            {"name": "SSH", "site": "ssh.example", "email": EMAIL, "id": "uuid-ssh",
             "updated_at": 103, "ssh": {"key_name": "github", "counter": 1}},
        ],
        "wallets": [],
        "wallet_audit_log": [],
    }


def _do_sync(monkeypatch, capsys, extra=None):
    monkeypatch.setattr(sync_client, "download_sync_content", lambda *a, **k: _content())
    argv = ["sync", "--email", EMAIL, "--secret-env", "KG_SECRET"] + (extra or [])
    return run(monkeypatch, capsys, argv)


def test_sync_writes_cache(home, monkeypatch, capsys):
    code, out, err = _do_sync(monkeypatch, capsys)
    assert code == 0
    assert "Synced 4 service(s)" in err
    assert cache_mod.resolve_account() == EMAIL


def test_sync_then_get_password_matches_derive(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)
    code, out, err = run(monkeypatch, capsys, ["get", "--site", "github.com", "--secret-env", "KG_SECRET"])
    assert code == 0
    expected = derive_password(SECRET.encode(), EMAIL, site="github.com", length=20,
                               symbols=DEFAULT_SYMBOLS, counter=1)
    assert out.strip() == expected
    # Resolved target echoed to stderr, not stdout.
    assert "Resolved: site=github.com" in err
    assert "service-email=" + EMAIL in err
    # Exact wins; sibling note names the subdomain.
    assert "accounts.github.com" in err


def test_get_infers_single_account(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)
    code, out, _ = run(monkeypatch, capsys, ["get", "--site", "github.com", "--secret-env", "KG_SECRET"])
    assert code == 0 and out.strip()


def test_get_totp_matches(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)
    code, out, err = run(monkeypatch, capsys,
                         ["get", "--site", "totp.example", "--totp", "--secret-env", "KG_SECRET"])
    assert code == 0
    seed = derive_totp_seed(SECRET.encode(), EMAIL, "totp.example")
    import time as _t
    expected = generate_totp(seed, int(_t.time()))
    assert out.strip() == expected


def test_get_totp_stored_mode(home, monkeypatch, capsys):
    content = _content()
    raw = b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09"
    content["services"].append({
        "name": "StoredTotp", "site": "stored.example", "email": EMAIL, "id": "uuid-st",
        "updated_at": 104, "totp": {"mode": "stored", "seed": base64.b64encode(raw).decode(),
                                     "digits": 6, "period": 30, "algorithm": "SHA1"}})
    monkeypatch.setattr(sync_client, "download_sync_content", lambda *a, **k: content)
    run(monkeypatch, capsys, ["sync", "--email", EMAIL, "--secret-env", "KG_SECRET"])
    code, out, _ = run(monkeypatch, capsys,
                       ["get", "--site", "stored.example", "--totp", "--secret-env", "KG_SECRET"])
    assert code == 0
    import time as _t
    assert out.strip() == generate_totp(raw, int(_t.time()))


def test_get_ssh_authorized_keys(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)
    code, out, _ = run(monkeypatch, capsys,
                       ["get", "--site", "ssh.example", "--ssh", "--secret-env", "KG_SECRET"])
    assert code == 0
    _seed, pub = derive_ssh_keypair(SECRET.encode(), EMAIL, key_name="github", counter=1)
    expected = format_authorized_keys(pub, f"{EMAIL}:github")
    assert out.strip() == expected


def test_get_totp_on_non_totp_service_errors(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)
    code, _, err = run(monkeypatch, capsys,
                       ["get", "--site", "github.com", "--totp", "--secret-env", "KG_SECRET"])
    assert code != 0
    assert "no TOTP" in err


def test_get_by_id(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)
    code, out, err = run(monkeypatch, capsys,
                         ["get", "--id", "uuid-sub", "--secret-env", "KG_SECRET"])
    assert code == 0
    assert "accounts.github.com" in err


def test_get_no_match(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)
    code, _, err = run(monkeypatch, capsys,
                       ["get", "--site", "nope.com", "--secret-env", "KG_SECRET"])
    assert code != 0 and "No service matches" in err


def test_get_ambiguous_lists_candidates(home, monkeypatch, capsys):
    content = _content()
    content["services"] = [
        {"name": "A", "site": "a.dup.com", "email": EMAIL, "id": "1", "updated_at": 1},
        {"name": "B", "site": "b.dup.com", "email": EMAIL, "id": "2", "updated_at": 2},
    ]
    monkeypatch.setattr(sync_client, "download_sync_content", lambda *a, **k: content)
    run(monkeypatch, capsys, ["sync", "--email", EMAIL, "--secret-env", "KG_SECRET"])
    code, _, err = run(monkeypatch, capsys,
                       ["get", "--site", "dup.com", "--secret-env", "KG_SECRET"])
    assert code != 0
    assert "id=1" in err and "id=2" in err


def test_list_shows_services(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)
    code, out, err = run(monkeypatch, capsys, ["list", "--secret-env", "KG_SECRET"])
    assert code == 0
    assert "github.com" in out and "uuid-gh" in out
    assert "last synced:" in err


def test_list_type_filter(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)
    code, out, _ = run(monkeypatch, capsys, ["list", "--type", "ssh", "--secret-env", "KG_SECRET"])
    assert code == 0
    assert "ssh.example" in out and "github.com" not in out


def test_list_aligned_table_has_header(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)
    code, out, err = run(monkeypatch, capsys, ["list", "--secret-env", "KG_SECRET"])
    assert code == 0
    lines = out.splitlines()
    # First stdout line is the aligned header row with the documented columns in order.
    header = lines[0]
    for col in ("NAME", "SITE", "EMAIL", "TYPES", "UPDATED", "ID"):
        assert col in header
    assert header.index("NAME") < header.index("SITE") < header.index("EMAIL") \
        < header.index("TYPES") < header.index("UPDATED") < header.index("ID")
    # Columns are aligned: the SITE column starts at the same offset on header and rows.
    site_col = header.index("SITE")
    gh_row = next(ln for ln in lines[1:] if "github.com" in ln and "accounts" not in ln)
    assert gh_row[site_col:].startswith("github.com")
    # Full UUID preserved (needed for `get --id`), not truncated.
    assert "uuid-gh" in out
    # Informational line stays on stderr, not stdout.
    assert "last synced:" in err and "last synced:" not in out


def test_list_human_readable_date(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)
    code, out, _ = run(monkeypatch, capsys, ["list", "--secret-env", "KG_SECRET"])
    assert code == 0
    # updated_at is rendered as a UTC calendar date, not a raw epoch.
    assert re.search(r"\b\d{4}-\d{2}-\d{2}\b", out)
    assert "1970-01-01" in out          # updated_at=100 -> epoch date
    assert "\tupdated=100" not in out    # old raw-epoch format is gone
    assert "100" not in out.splitlines()[1]  # no raw epoch on the first data row


def test_list_missing_fields_render_dash(home, monkeypatch, capsys):
    content = {"services": [{"site": "bare.example", "email": EMAIL, "id": "uuid-bare"}],
               "wallets": [], "wallet_audit_log": []}
    monkeypatch.setattr(sync_client, "download_sync_content", lambda *a, **k: content)
    run(monkeypatch, capsys, ["sync", "--email", EMAIL, "--secret-env", "KG_SECRET"])
    code, out, _ = run(monkeypatch, capsys, ["list", "--secret-env", "KG_SECRET"])
    assert code == 0
    data_row = out.splitlines()[1]
    assert data_row.split()[0] == "-"   # missing name -> '-'
    assert "-" in data_row              # missing updated_at -> '-'


def test_list_no_cache(home, monkeypatch, capsys):
    code, _, err = run(monkeypatch, capsys, ["list", "--secret-env", "KG_SECRET"])
    assert code != 0 and "No local cache" in err


def test_get_no_cache(home, monkeypatch, capsys):
    code, _, err = run(monkeypatch, capsys, ["get", "--site", "x", "--secret-env", "KG_SECRET"])
    assert code != 0 and "No local cache" in err


def test_sync_404_leaves_cache_untouched(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys)  # establish a cache
    before = open(cache_mod.cache_path(EMAIL), "rb").read()

    def raise_404(*a, **k):
        raise sync_client.NotFoundError("nope")

    monkeypatch.setattr(sync_client, "download_sync_content", raise_404)
    code, _, err = run(monkeypatch, capsys,
                       ["sync", "--email", EMAIL, "--secret-env", "KG_SECRET"])
    assert code != 0
    assert "No data on server" in err
    assert open(cache_mod.cache_path(EMAIL), "rb").read() == before  # untouched


def test_sync_auth_error(home, monkeypatch, capsys):
    def raise_auth(*a, **k):
        raise sync_client.AuthError("bad")
    monkeypatch.setattr(sync_client, "download_sync_content", raise_auth)
    code, _, err = run(monkeypatch, capsys,
                       ["sync", "--email", EMAIL, "--secret-env", "KG_SECRET"])
    assert code != 0 and "Authentication failed" in err


def test_lock_blocks_sync_then_unlock(home, monkeypatch, capsys):
    _do_sync(monkeypatch, capsys, extra=["--lock"])
    assert cache_mod.is_locked(EMAIL)
    # sync refuses while locked (before network).
    code, _, err = run(monkeypatch, capsys,
                       ["sync", "--email", EMAIL, "--secret-env", "KG_SECRET"])
    assert code != 0 and "locked" in err.lower()
    # unlock (non-interactive: no confirm prompt).
    code2, _, err2 = run(monkeypatch, capsys, ["sync", "--email", EMAIL, "--unlock"])
    assert code2 == 0
    assert not cache_mod.is_locked(EMAIL)


def test_sync_server_override_persisted_in_body(home, monkeypatch, capsys):
    captured = {}

    def fake_dl(server_url, secret, email, **k):
        captured["server"] = server_url
        return _content()

    monkeypatch.setattr(sync_client, "download_sync_content", fake_dl)
    run(monkeypatch, capsys,
        ["sync", "--email", EMAIL, "--server", "https://self.hosted", "--secret-env", "KG_SECRET"])
    assert captured["server"] == "https://self.hosted"
    # server_url is inside the encrypted body, not the plaintext header.
    import json
    envelope = json.loads(open(cache_mod.cache_path(EMAIL)).read())
    assert "self.hosted" not in json.dumps(envelope)
    data = cache_mod.read_cache(SECRET.encode(), EMAIL)
    assert data["server_url"] == "https://self.hosted"


def test_existing_password_command_unchanged(home, monkeypatch, capsys):
    monkeypatch.setenv("KEYGRAIN_SECRET", SECRET)
    code, out, _ = run(monkeypatch, capsys, ["password", EMAIL, "--site", "github.com"])
    assert code == 0
    expected = derive_password(SECRET.encode(), EMAIL, site="github.com")
    assert out.strip() == expected


def test_no_secret_source_does_not_leak_env(home, monkeypatch, capsys):
    # Security regression: a new subcommand with NO --secret-env in a non-TTY
    # context MUST fail rather than silently reading KEYGRAIN_SECRET (the parent
    # parser's default). Pins the subparser default=None so a refactor can't
    # reintroduce the parent-default env leak.
    monkeypatch.setenv("KEYGRAIN_SECRET", "SENTINEL-should-not-be-used")
    _do_sync(monkeypatch, capsys)  # establish a cache so `get` reaches secret resolution
    monkeypatch.setattr("sys.stdin.isatty", lambda: False)
    code, out, err = run(monkeypatch, capsys, ["get", "--site", "github.com"])
    assert code != 0
    assert "No secret source" in err
    assert out.strip() == ""  # no password derived from the leaked env secret

    # sync (first path) likewise must not read the env silently.
    code2, _, err2 = run(monkeypatch, capsys, ["sync", "--email", EMAIL])
    assert code2 != 0
    assert "No secret source" in err2


# --- Top-level help + honest command routing (FIX 2) ---

_ALL_COMMANDS = ["password", "sync", "list", "get", "ssh", "wallet", "totp", "wallet-bip85"]


def test_top_level_help_lists_all_commands(monkeypatch, capsys):
    code, out, _ = run(monkeypatch, capsys, ["--help"])
    assert code == 0
    for cmd in _ALL_COMMANDS:
        assert cmd in out
    # Documents the default bare form.
    assert "--site" in out and "<email>" in out


def test_short_help_flag_lists_commands(monkeypatch, capsys):
    code, out, _ = run(monkeypatch, capsys, ["-h"])
    assert code == 0
    assert "sync" in out and "list" in out and "get" in out


def test_no_args_shows_top_level_help(monkeypatch, capsys):
    code, out, _ = run(monkeypatch, capsys, [])
    assert code == 0
    assert "sync" in out and "list" in out and "get" in out


def test_unknown_command_exits_nonzero_and_lists_commands(monkeypatch, capsys):
    code, out, err = run(monkeypatch, capsys, ["frobnicate"])
    assert code != 0
    # Command list goes to stderr for the error path; NOT the misleading "--site required".
    assert "sync" in err and "list" in err and "get" in err
    assert "--site is required" not in err and "--site is required" not in out


def test_bare_form_missing_site_lists_commands(monkeypatch, capsys):
    # `keygrain me@x.com` (no --site): incomplete -> command list, non-zero.
    code, out, err = run(monkeypatch, capsys, ["me@example.com"])
    assert code != 0
    assert "sync" in err and "list" in err


def test_version_flag_still_works(monkeypatch, capsys):
    code, out, _ = run(monkeypatch, capsys, ["--version"])
    assert code == 0
    assert "keygrain" in out


def test_bare_form_non_at_identifier_still_derives(monkeypatch, capsys):
    # Regression guard: email validation does not require '@', so a non-@ bare
    # identifier + --site must still derive a password (routing keys off --site,
    # never off '@').
    monkeypatch.setenv("KEYGRAIN_SECRET", SECRET)
    code, out, _ = run(monkeypatch, capsys, ["alice", "--site", "github.com"])
    assert code == 0
    expected = derive_password(SECRET.encode(), "alice", site="github.com")
    assert out.strip() == expected


def test_bare_form_email_still_derives(monkeypatch, capsys):
    monkeypatch.setenv("KEYGRAIN_SECRET", SECRET)
    code, out, _ = run(monkeypatch, capsys, [EMAIL, "--site", "github.com"])
    assert code == 0
    expected = derive_password(SECRET.encode(), EMAIL, site="github.com")
    assert out.strip() == expected


def test_subcommand_help_still_works(monkeypatch, capsys):
    # The dispatch change must not break a subcommand's own --help.
    code, out, _ = run(monkeypatch, capsys, ["list", "--help"])
    assert code == 0
    assert "--type" in out and "--service-email" in out
