"""Tests for --version flag and git-aware version resolution."""

import subprocess
from unittest.mock import MagicMock, patch

from keygrain.cli import __version__, _resolve_version


def test_version_not_dev():
    """Ensure package metadata is found (catches package name typos)."""
    assert __version__ != "dev"
    assert not __version__.startswith("dev")


def test_version_format():
    """Version string should be a valid PEP 440 format with semver base and optional git suffix."""
    base = __version__.split("+")[0]
    parts = base.split(".")
    assert len(parts) == 3
    assert all(p.isdigit() for p in parts)

    if "+" in __version__:
        local = __version__.split("+", 1)[1]
        local_parts = local.split(".")
        # Must start with 'g' followed by at least 7 hex characters
        assert local_parts[0].startswith("g")
        assert len(local_parts[0]) >= 8
        assert all(c in "0123456789abcdef" for c in local_parts[0][1:])
        if len(local_parts) > 1:
            assert local_parts[1] == "dirty"


def test_resolve_version_git_clean():
    """Clean git repo appends +g<hash>."""
    def fake_run(cmd, *args, **kwargs):
        if cmd[1] == "rev-parse" and cmd[2] == "--is-inside-work-tree":
            return subprocess.CompletedProcess(cmd, 0, stdout="true\n")
        if cmd[1] == "ls-files":
            return subprocess.CompletedProcess(cmd, 0, stdout="cli.py\n")
        if cmd[1] == "rev-parse" and cmd[2] == "--short=7":
            return subprocess.CompletedProcess(cmd, 0, stdout="a1b2c3d\n")
        if cmd[1] == "status":
            return subprocess.CompletedProcess(cmd, 0, stdout="")
        return subprocess.CompletedProcess(cmd, 1, stdout="")

    with patch("subprocess.run", side_effect=fake_run):
        ver = _resolve_version(base_version="2.0.0")
        assert ver == "2.0.0+ga1b2c3d"


def test_resolve_version_git_dirty():
    """Dirty git repo appends +g<hash>.dirty."""
    def fake_run(cmd, *args, **kwargs):
        if cmd[1] == "rev-parse" and cmd[2] == "--is-inside-work-tree":
            return subprocess.CompletedProcess(cmd, 0, stdout="true\n")
        if cmd[1] == "ls-files":
            return subprocess.CompletedProcess(cmd, 0, stdout="cli.py\n")
        if cmd[1] == "rev-parse" and cmd[2] == "--short=7":
            return subprocess.CompletedProcess(cmd, 0, stdout="a1b2c3d\n")
        if cmd[1] == "status":
            return subprocess.CompletedProcess(cmd, 0, stdout=" M keygrain/cli.py\n")
        return subprocess.CompletedProcess(cmd, 1, stdout="")

    with patch("subprocess.run", side_effect=fake_run):
        ver = _resolve_version(base_version="2.0.0")
        assert ver == "2.0.0+ga1b2c3d.dirty"


def test_resolve_version_dev_fallback():
    """When base version is dev, appends git info appropriately."""
    def fake_run(cmd, *args, **kwargs):
        if cmd[1] == "rev-parse" and cmd[2] == "--is-inside-work-tree":
            return subprocess.CompletedProcess(cmd, 0, stdout="true\n")
        if cmd[1] == "ls-files":
            return subprocess.CompletedProcess(cmd, 0, stdout="cli.py\n")
        if cmd[1] == "rev-parse" and cmd[2] == "--short=7":
            return subprocess.CompletedProcess(cmd, 0, stdout="deadbeef\n")
        if cmd[1] == "status":
            return subprocess.CompletedProcess(cmd, 0, stdout="?? new.txt\n")
        return subprocess.CompletedProcess(cmd, 1, stdout="")

    with patch("subprocess.run", side_effect=fake_run):
        ver = _resolve_version(base_version="dev")
        assert ver == "dev+gdeadbeef.dirty"


def test_resolve_version_not_in_worktree():
    """Returns base version when not inside a git worktree."""
    def fake_run(cmd, *args, **kwargs):
        return subprocess.CompletedProcess(cmd, 128, stdout="fatal: not a git repository\n")

    with patch("subprocess.run", side_effect=fake_run):
        ver = _resolve_version(base_version="1.0.1")
        assert ver == "1.0.1"


def test_resolve_version_file_not_tracked():
    """Returns base version when file is not tracked (e.g. wheel install in another repo)."""
    def fake_run(cmd, *args, **kwargs):
        if cmd[1] == "rev-parse" and cmd[2] == "--is-inside-work-tree":
            return subprocess.CompletedProcess(cmd, 0, stdout="true\n")
        if cmd[1] == "ls-files":
            return subprocess.CompletedProcess(cmd, 1, stdout="")
        return subprocess.CompletedProcess(cmd, 0, stdout="")

    with patch("subprocess.run", side_effect=fake_run):
        ver = _resolve_version(base_version="1.0.1")
        assert ver == "1.0.1"


def test_resolve_version_git_exception_safe():
    """Subprocess exceptions gracefully fall back to base version without crashing."""
    with patch("subprocess.run", side_effect=FileNotFoundError("git not found")):
        ver = _resolve_version(base_version="1.0.1")
        assert ver == "1.0.1"

    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd=["git"], timeout=2)):
        ver = _resolve_version(base_version="1.0.1")
        assert ver == "1.0.1"

    with patch("subprocess.run", side_effect=RuntimeError("unexpected")):
        ver = _resolve_version(base_version="1.0.1")
        assert ver == "1.0.1"


def test_resolve_version_scoped_status_check():
    """Ensures git status is scoped to the component directory with '-- .'."""
    recorded_calls = []

    def fake_run(cmd, *args, **kwargs):
        recorded_calls.append((cmd, kwargs))
        if cmd[1] == "rev-parse" and cmd[2] == "--is-inside-work-tree":
            return subprocess.CompletedProcess(cmd, 0, stdout="true\n")
        if cmd[1] == "ls-files":
            return subprocess.CompletedProcess(cmd, 0, stdout="cli.py\n")
        if cmd[1] == "rev-parse" and cmd[2] == "--short=7":
            return subprocess.CompletedProcess(cmd, 0, stdout="1234567\n")
        if cmd[1] == "status":
            return subprocess.CompletedProcess(cmd, 0, stdout="")
        return subprocess.CompletedProcess(cmd, 0, stdout="")

    with patch("subprocess.run", side_effect=fake_run):
        _resolve_version(base_version="1.0.1")

    # Find the git status call
    status_calls = [c for c in recorded_calls if c[0][1] == "status"]
    assert len(status_calls) == 1
    cmd, kwargs = status_calls[0]
    # Must use path-scoped arguments ['git', 'status', '--porcelain', '--', '.']
    assert cmd == ["git", "status", "--porcelain", "--", "."]
    assert "cwd" in kwargs
