"""TRUE end-to-end integration test for the read-only sync path.

Unlike ``test_sync_vectors.py`` (which patches ``sync_client._urlopen`` with a
fake response, splitting the network seam), this module drives the REAL network
code path: a real local HTTP server on ``127.0.0.1`` (ephemeral port, in a
daemon thread) serves the fixture's ``server_response``, and
``sync_client.download_sync_content`` performs a genuine ``urllib`` GET over the
socket. **No ``_urlopen`` patch is applied anywhere in this file.**

The proof that live I/O actually happened is SERVER-SIDE, not a tautological
"is the function still itself" check: the handler records every request it
receives, and the happy-path tests assert the server got
``GET /api/sync/<derived lookup_id>`` with an ``Authorization: Basic`` header.
Those assertions cannot pass unless the real opener reached the socket.

The 302 test proves the no-redirect opener against an ACTUAL 3xx (not a mock):
the server returns a 302 whose ``Location`` points back at the same server, so
if the opener ever *followed* the redirect the handler would record a second
request. It does not — exactly one request is recorded — which also proves the
``Authorization`` header is never re-sent to the redirect target.

Everything is hermetic: bind 127.0.0.1:0, silence request logging, and shut the
server down in teardown. No external network.
"""

import http.server
import json
import pathlib
import threading
import time

import pytest

from keygrain import cli, cache as cache_mod, sync_client as sc
from keygrain.totp import generate_totp

FIXTURE_PATH = pathlib.Path(__file__).resolve().parents[2] / "sync-vectors.json"
FIXTURE = json.loads(FIXTURE_PATH.read_text())

SECRET = FIXTURE["secret"]  # str; encoded to bytes at call sites (real code takes bytes)
EMAIL = FIXTURE["email"]
SERVER_BODY = json.dumps(FIXTURE["server_response"]).encode("utf-8")

# Derived independently (per the reviewer): the path the server MUST receive.
EXPECTED_LOOKUP_ID = sc.derive_lookup_id(SECRET.encode(), EMAIL)
EXPECTED_PATH = "/api/sync/" + EXPECTED_LOOKUP_ID

# A same-server path the redirect points at. If the opener ever followed the
# 302, the handler would record a request to this path. It must never appear.
_REDIRECT_TARGET_PATH = "/redirected-should-never-be-followed"


def _make_handler(received: list, mode: str, body: bytes):
    """Build a BaseHTTPRequestHandler that records requests and serves ``mode``.

    ``mode`` is ``"ok"`` (200 + ETag + fixture body) or ``"redirect"`` (302 with
    a same-server relative ``Location``). Every received GET is appended to
    ``received`` so tests can prove the socket was actually hit.
    """

    class _Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):  # noqa: D102 - silence stderr request spam
            pass

        def do_GET(self):  # noqa: N802 - http.server API
            received.append(
                {
                    "path": self.path,
                    "method": self.command,
                    "has_basic_auth": self.headers.get("Authorization", "").startswith("Basic "),
                }
            )
            if mode == "redirect":
                self.send_response(302)
                self.send_header("Location", _REDIRECT_TARGET_PATH)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("ETag", '"e2e-etag-v1"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return _Handler


class _LocalServer:
    """A hermetic 127.0.0.1 HTTP server on an ephemeral port, in a daemon thread."""

    def __init__(self, mode: str):
        self.received: list = []
        handler = _make_handler(self.received, mode, SERVER_BODY)
        self._httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.base_url = "http://127.0.0.1:%d" % self._httpd.server_address[1]
        # serve_forever in the daemon thread; shutdown() is called cross-thread
        # from the main (fixture-teardown) thread, which is the documented pattern.
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        self._httpd.shutdown()
        self._httpd.server_close()
        self._thread.join(timeout=5)


@pytest.fixture
def ok_server():
    srv = _LocalServer("ok")
    try:
        yield srv
    finally:
        srv.stop()


@pytest.fixture
def redirect_server():
    srv = _LocalServer("redirect")
    try:
        yield srv
    finally:
        srv.stop()


@pytest.fixture
def home(tmp_path, monkeypatch):
    """Isolate the cache dir via the SAME injection point the cache tests use.

    Never touches ~/.keygrain.
    """
    h = str(tmp_path / "kg")
    monkeypatch.setattr(cache_mod, "keygrain_home", lambda: h)
    monkeypatch.setenv("KG_SECRET", SECRET)
    return h


def _run_cli(monkeypatch, capsys, argv):
    monkeypatch.setattr("sys.argv", ["keygrain"] + argv)
    code = 0
    try:
        cli.main()
    except SystemExit as e:
        code = e.code or 0
    cap = capsys.readouterr()
    return code, cap.out, cap.err


# --- Test A: real download over a socket, proven server-side, then real get ---

def test_real_http_download_hits_socket_then_derives_password(ok_server, home, monkeypatch, capsys):
    # REAL urllib GET over the socket — no _urlopen patch.
    content = sc.download_sync_content(ok_server.base_url, SECRET.encode(), EMAIL)

    # SERVER-SIDE proof the live opener reached the socket (not a short-circuit):
    assert len(ok_server.received) == 1
    req = ok_server.received[0]
    assert req["method"] == "GET"
    assert req["path"] == EXPECTED_PATH
    assert req["has_basic_auth"], "Authorization: Basic header must reach the server"

    # Decrypted, index-enriched content matches the fixture.
    by_key = {(s.get("site"), s.get("email")): s for s in content["services"]}
    for fsvc in FIXTURE["services"]:
        s = by_key[(fsvc["site"], fsvc["email"])]
        assert s["id"] == fsvc["id"]
        assert s["updated_at"] == fsvc["updated_at"]

    # Real cache write, then the REAL get path via cli.main (resolve -> read ->
    # select -> derive), exactly as a user would run it.
    cache_mod.write_cache(SECRET.encode(), EMAIL, content, server_url=ok_server.base_url)
    code, out, err = _run_cli(
        monkeypatch, capsys, ["get", "--site", "github.com", "--secret-env", "KG_SECRET"]
    )
    assert code == 0, err
    gh = next(s for s in FIXTURE["services"] if s["site"] == "github.com")
    assert out.strip() == gh["expected"]["password"]


# --- Test B: every credential type end-to-end through the real path -----------

def test_real_http_end_to_end_all_services(ok_server, home, monkeypatch, capsys):
    content = sc.download_sync_content(ok_server.base_url, SECRET.encode(), EMAIL)
    assert ok_server.received[0]["path"] == EXPECTED_PATH  # socket was hit
    cache_mod.write_cache(SECRET.encode(), EMAIL, content, server_url=ok_server.base_url)

    # shared.example is present twice -> exercises --service-email disambiguation.
    for svc in [s for s in FIXTURE["services"] if s["site"] == "shared.example"]:
        code, out, err = _run_cli(
            monkeypatch, capsys,
            ["get", "--site", "shared.example", "--service-email", svc["email"],
             "--secret-env", "KG_SECRET"],
        )
        assert code == 0, err
        assert out.strip() == svc["expected"]["password"]

    # TOTP (derived seed) — compare against generate_totp(seed, now), matching
    # the existing cross-platform suite's time-window approach.
    totp_svc = next(s for s in FIXTURE["services"] if "totp_seed_hex" in s["expected"])
    code, out, err = _run_cli(
        monkeypatch, capsys,
        ["get", "--site", totp_svc["site"], "--totp", "--secret-env", "KG_SECRET"],
    )
    assert code == 0, err
    seed = bytes.fromhex(totp_svc["expected"]["totp_seed_hex"])
    assert out.strip() == generate_totp(seed, int(time.time()))

    # SSH authorized_keys line.
    ssh_svc = next(s for s in FIXTURE["services"] if "ssh_authorized_keys" in s["expected"])
    code, out, err = _run_cli(
        monkeypatch, capsys,
        ["get", "--site", ssh_svc["site"], "--ssh", "--secret-env", "KG_SECRET"],
    )
    assert code == 0, err
    assert out.strip() == ssh_svc["expected"]["ssh_authorized_keys"]


# --- Test C: the REAL opener refuses an ACTUAL 302 (not a mock) ---------------

def test_real_302_is_refused_and_never_followed(redirect_server):
    with pytest.raises(sc.ServerError):
        sc.download_sync_content(redirect_server.base_url, SECRET.encode(), EMAIL)

    # The no-redirect opener raised from redirect_request BEFORE building the
    # follow-up request: exactly one request (the original) was recorded, and
    # the same-server redirect target was never contacted -> the Authorization
    # header could never have been re-sent to the redirect location.
    assert len(redirect_server.received) == 1
    assert redirect_server.received[0]["path"] == EXPECTED_PATH
    assert not any(r["path"] == _REDIRECT_TARGET_PATH for r in redirect_server.received)
