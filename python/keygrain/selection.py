"""Service selection and filtering for `keygrain list` / `keygrain get`.

Selection rules (design §E):

- ``--id <uuid>``  — exact match on the server-assigned entry id.
- ``--site <substr>`` — **label-boundary suffix** match, optionally narrowed by
  ``--service-email <addr>``. ``github.com`` matches ``github.com`` and
  ``accounts.github.com``; ``bank`` does NOT match ``fakebank.com`` (not a whole
  label).
- **Exact site match wins** over suffix matches.
- **Any ambiguity is a hard error** listing the candidates — never guess.
- When an exact match is chosen but subdomain siblings also match, the siblings
  are returned so the caller can print a non-blocking note.
"""

from .derive import normalize_site


class SelectionError(Exception):
    """Base class for selection failures."""


class NoMatchError(SelectionError):
    """No service matched the query."""


class AmbiguousMatchError(SelectionError):
    """More than one service matched and the query cannot disambiguate."""

    def __init__(self, message: str, candidates: list[dict]):
        super().__init__(message)
        self.candidates = candidates


def site_matches(query_normalized: str, site_normalized: str) -> bool:
    """Label-boundary suffix match: exact, or ``query`` is a whole-label suffix."""
    if not query_normalized or not site_normalized:
        return False
    if site_normalized == query_normalized:
        return True
    return site_normalized.endswith("." + query_normalized)


def _service_email(service: dict) -> str:
    return (service.get("email") or "").lower()


def format_candidate(service: dict) -> str:
    """Human-readable one-line candidate description (site, email, id, name)."""
    return (
        f"site={service.get('site', '?')} "
        f"service-email={service.get('email', '?')} "
        f"id={service.get('id', '?')} "
        f"name={service.get('name', '?')}"
    )


def select_service(
    services: list[dict],
    *,
    entry_id: str | None = None,
    site: str | None = None,
    service_email: str | None = None,
) -> tuple[dict, list[dict]]:
    """Select exactly one service.

    Returns ``(selected, siblings)`` where ``siblings`` is a possibly-empty list
    of subdomain-sibling services matched by suffix when an exact match was used
    (for a non-blocking caller note).

    Raises:
        ValueError: if neither/both of entry_id and site are given.
        NoMatchError / AmbiguousMatchError.
    """
    if (entry_id is None) == (site is None):
        raise ValueError("Provide exactly one of entry_id or site.")

    if entry_id is not None:
        matches = [s for s in services if s.get("id") == entry_id]
        if not matches:
            raise NoMatchError(f"No service matches id {entry_id!r}.")
        if len(matches) > 1:
            raise AmbiguousMatchError(
                f"Multiple services share id {entry_id!r} (corrupt cache?).", matches
            )
        return matches[0], []

    # --site path
    query = normalize_site(site)
    if not query:
        raise NoMatchError("Empty --site query after normalization.")

    pool = services
    if service_email is not None:
        addr = service_email.lower()
        pool = [s for s in pool if _service_email(s) == addr]

    matches = [s for s in pool if site_matches(query, normalize_site(s.get("site", "")))]
    if not matches:
        raise NoMatchError(f"No service matches site {site!r}"
                           + (f" with service-email {service_email!r}." if service_email else "."))

    exact = [s for s in matches if normalize_site(s.get("site", "")) == query]
    if exact:
        if len(exact) > 1:
            raise AmbiguousMatchError(
                f"Multiple services match site {site!r}; narrow with --service-email or use --id.",
                exact,
            )
        selected = exact[0]
        siblings = [s for s in matches if s is not selected]
        return selected, siblings

    # No exact match: only suffix matches.
    if len(matches) > 1:
        raise AmbiguousMatchError(
            f"Multiple services match site {site!r}; narrow with --service-email or use --id.",
            matches,
        )
    return matches[0], []


def filter_services(
    services: list[dict],
    *,
    site: str | None = None,
    service_email: str | None = None,
    type_: str | None = None,
) -> list[dict]:
    """Filter services for `keygrain list` (non-selecting; returns all matches)."""
    result = list(services)
    if site is not None:
        query = normalize_site(site)
        result = [s for s in result if site_matches(query, normalize_site(s.get("site", "")))]
    if service_email is not None:
        addr = service_email.lower()
        result = [s for s in result if _service_email(s) == addr]
    if type_ is not None:
        result = [s for s in result if type_ in types_present(s)]
    return result


def types_present(service: dict) -> list[str]:
    """Credential types available for a service (password is always derivable)."""
    types = ["password"]
    if service.get("totp"):
        types.append("totp")
    if service.get("ssh"):
        types.append("ssh")
    return types
