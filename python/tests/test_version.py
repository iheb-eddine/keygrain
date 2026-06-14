"""Tests for --version flag."""

from keygrain.cli import __version__


def test_version_not_dev():
    """Ensure package metadata is found (catches package name typos)."""
    assert __version__ != "dev"


def test_version_format():
    """Version string should be a valid semver-like format."""
    parts = __version__.split(".")
    assert len(parts) == 3
    assert all(p.isdigit() for p in parts)
