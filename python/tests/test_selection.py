"""Tests for keygrain.selection (matching, exact-wins, ambiguity, filters)."""

import pytest

from keygrain import selection as sel


def svc(site, email="me@x.com", id=None, name=None, totp=None, ssh=None):
    d = {"site": site, "email": email, "id": id, "name": name}
    if totp:
        d["totp"] = totp
    if ssh:
        d["ssh"] = ssh
    return d


# --- label-boundary suffix matching ---

def test_exact_match():
    assert sel.site_matches("github.com", "github.com")


def test_subdomain_suffix_match():
    assert sel.site_matches("github.com", "accounts.github.com")


def test_not_partial_label_match():
    # "bank" must NOT match "fakebank.com" (not a whole label).
    assert not sel.site_matches("bank", "fakebank.com")


def test_not_substring_across_label_boundary():
    assert not sel.site_matches("bank.com", "fakebank.com")


def test_empty_no_match():
    assert not sel.site_matches("", "github.com")
    assert not sel.site_matches("github.com", "")


# --- select by id ---

def test_select_by_id():
    services = [svc("a.com", id="1"), svc("b.com", id="2")]
    selected, siblings = sel.select_service(services, entry_id="2")
    assert selected["site"] == "b.com"
    assert siblings == []


def test_select_by_id_no_match():
    with pytest.raises(sel.NoMatchError):
        sel.select_service([svc("a.com", id="1")], entry_id="999")


def test_select_requires_exactly_one_key():
    with pytest.raises(ValueError):
        sel.select_service([], entry_id="1", site="x")
    with pytest.raises(ValueError):
        sel.select_service([])


# --- select by site ---

def test_exact_wins_over_suffix_and_reports_siblings():
    services = [svc("github.com", id="1"), svc("accounts.github.com", id="2")]
    selected, siblings = sel.select_service(services, site="github.com")
    assert selected["id"] == "1"
    assert [s["id"] for s in siblings] == ["2"]


def test_single_suffix_match_selected():
    services = [svc("accounts.github.com", id="2")]
    selected, siblings = sel.select_service(services, site="github.com")
    assert selected["id"] == "2"
    assert siblings == []


def test_ambiguous_suffix_matches_hard_error():
    services = [svc("a.github.com", id="1"), svc("b.github.com", id="2")]
    with pytest.raises(sel.AmbiguousMatchError) as ei:
        sel.select_service(services, site="github.com")
    assert len(ei.value.candidates) == 2


def test_ambiguous_exact_same_site_diff_email():
    services = [svc("github.com", email="a@x.com", id="1"), svc("github.com", email="b@x.com", id="2")]
    with pytest.raises(sel.AmbiguousMatchError):
        sel.select_service(services, site="github.com")


def test_service_email_narrows_to_one():
    services = [svc("github.com", email="a@x.com", id="1"), svc("github.com", email="b@x.com", id="2")]
    selected, _ = sel.select_service(services, site="github.com", service_email="B@X.com")
    assert selected["id"] == "2"


def test_no_match_site():
    with pytest.raises(sel.NoMatchError):
        sel.select_service([svc("github.com", id="1")], site="gitlab.com")


def test_no_match_after_email_filter():
    with pytest.raises(sel.NoMatchError):
        sel.select_service([svc("github.com", email="a@x.com", id="1")],
                           site="github.com", service_email="other@x.com")


def test_query_normalized():
    services = [svc("github.com", id="1")]
    selected, _ = sel.select_service(services, site="https://github.com/login")
    assert selected["id"] == "1"


def test_fakebank_not_selected_for_bank():
    with pytest.raises(sel.NoMatchError):
        sel.select_service([svc("fakebank.com", id="1")], site="bank")


# --- filters (list) ---

def test_filter_by_site_suffix():
    services = [svc("github.com", id="1"), svc("accounts.github.com", id="2"), svc("gitlab.com", id="3")]
    out = sel.filter_services(services, site="github.com")
    assert {s["id"] for s in out} == {"1", "2"}


def test_filter_by_email():
    services = [svc("a.com", email="x@x.com", id="1"), svc("b.com", email="y@x.com", id="2")]
    out = sel.filter_services(services, service_email="X@X.com")
    assert [s["id"] for s in out] == ["1"]


def test_filter_by_type():
    services = [
        svc("a.com", id="1"),
        svc("b.com", id="2", totp={"mode": "derived"}),
        svc("c.com", id="3", ssh={"key_name": "k"}),
    ]
    assert {s["id"] for s in sel.filter_services(services, type_="totp")} == {"2"}
    assert {s["id"] for s in sel.filter_services(services, type_="ssh")} == {"3"}
    assert {s["id"] for s in sel.filter_services(services, type_="password")} == {"1", "2", "3"}


def test_types_present():
    assert sel.types_present(svc("a.com")) == ["password"]
    assert "totp" in sel.types_present(svc("a.com", totp={"mode": "derived"}))
    assert "ssh" in sel.types_present(svc("a.com", ssh={"key_name": "k"}))


def test_format_candidate():
    s = svc("github.com", email="me@x.com", id="uuid-1", name="GitHub")
    line = sel.format_candidate(s)
    assert "github.com" in line and "uuid-1" in line and "me@x.com" in line and "GitHub" in line
