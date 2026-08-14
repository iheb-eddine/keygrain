"""Independent byte/schema checks for the KG-29 v3 preservation contract.

This test intentionally does not import a production sync parser or serializer. The
fixture is a future contract and current clients are not declared v3 preservers.
"""

import hashlib
import json
import pathlib
import struct


ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "sync-v3-preservation-vectors.json").read_text(encoding="utf-8"))


def _codepoint_key(value):
    return tuple(ord(char) for char in value)


def _canonical_string(value):
    out = ['"']
    for char in value:
        code = ord(char)
        if char == "\b":
            out.append(r"\b")
        elif char == "\t":
            out.append(r"\t")
        elif char == "\n":
            out.append(r"\n")
        elif char == "\f":
            out.append(r"\f")
        elif char == "\r":
            out.append(r"\r")
        elif char == '"':
            out.append(r'\"')
        elif char == "\\":
            out.append(r"\\")
        elif code <= 0x1F:
            out.append(f"\\u{code:04x}")
        elif 0xD800 <= code <= 0xDFFF:
            out.append(f"\\u{code:04x}")
        else:
            out.append(char)
    out.append('"')
    return "".join(out)


def _canonical_json(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        assert -(2**53 - 1) <= value <= 2**53 - 1
        return str(value)
    if isinstance(value, str):
        return _canonical_string(value)
    if isinstance(value, list):
        return "[" + ",".join(_canonical_json(item) for item in value) + "]"
    assert isinstance(value, dict)
    return "{" + ",".join(
        _canonical_string(key) + ":" + _canonical_json(value[key])
        for key in sorted(value, key=_codepoint_key)
    ) + "}"


def _canonical_payload(payload):
    ordered = dict(payload)
    ordered["services"] = sorted(payload["services"], key=lambda item: _codepoint_key(item.get("id") or ""))
    ordered["wallets"] = sorted(
        payload["wallets"],
        key=lambda item: _codepoint_key(
            f'{(item.get("wallet_name") or "").lower()}:{(item.get("chain") or "").lower()}'
        ),
    )
    ordered["wallet_audit_log"] = sorted(
        payload["wallet_audit_log"],
        key=lambda item: _codepoint_key(
            f'{item["timestamp"]}\x00{item["wallet_name"]}\x00{item["chain"]}\x00{item["action"]}'
        ),
    )
    ordered["sync_conflicts"] = sorted(
        payload["sync_conflicts"], key=lambda item: _codepoint_key(item["conflict_id"])
    )
    return _canonical_json(ordered)


def _all_keys(value, result=None):
    result = result or set()
    if isinstance(value, list):
        for item in value:
            _all_keys(item, result)
    elif isinstance(value, dict):
        for key, child in value.items():
            result.add(key)
            _all_keys(child, result)
    return result


def _aad(envelope):
    commitment = envelope["defaults_commitment"] or ""
    return (
        f'keygrain-sync-v3\x00{envelope["lookup_id"]}\x00'
        f'{envelope["defaults_state"]}\x00{commitment}'
    ).encode("utf-8").hex()


def _etag(envelope):
    states = {"UNSEALED": 0, "ABSENT": 1, "PRESENT": 2}
    commitment = (envelope["defaults_commitment"] or "").encode("ascii")
    blob = bytes.fromhex(envelope["blob_hex"])
    encoded = (
        b"keygrain-sync-v3-etag\x00"
        + struct.pack(">I", 3)
        + struct.pack(">Q", envelope["generation"])
        + bytes([states[envelope["defaults_state"]]])
        + struct.pack(">I", len(commitment))
        + commitment
        + struct.pack(">Q", len(blob))
        + blob
    )
    return hashlib.sha256(encoded).hexdigest()[:32]


def test_fixture_is_future_contract_not_runtime_support():
    assert FIXTURE["fixture"] == "keygrain-sync-v3-preservation-contract"
    assert FIXTURE["fixture_version"] == 1
    assert FIXTURE["status"] == "frozen_public_contract_not_runtime_support_claim"
    assert FIXTURE["runtime_support"] is False
    assert len(FIXTURE["cases"]) == 2


def test_partitions_are_exact_and_disjoint():
    partitions = FIXTURE["partitions"]
    assert partitions["encrypted_plaintext"] == [
        "version", "services", "wallets", "wallet_audit_log", "account_defaults", "sync_conflicts"
    ]
    values = [field for fields in partitions.values() for field in fields]
    assert len(values) == len(set(values))


def test_payload_shape_version_and_explicit_defaults_key():
    expected = set(FIXTURE["partitions"]["encrypted_plaintext"])
    for case in FIXTURE["cases"]:
        payload = case["encrypted_plaintext_source"]
        assert set(payload) == expected
        assert payload["version"] == 3
        assert "account_defaults" in payload
        for service in payload["services"]:
            assert service["defaults_mode"] in {"explicit", "snapshot"}
            assert service["defaults_revision"] is None or (
                type(service["defaults_revision"]) is int and -(2**53 - 1) <= service["defaults_revision"] <= 2**53 - 1
            )


def test_independent_canonical_bytes_match_literal_utf8_and_hex():
    for case in FIXTURE["cases"]:
        actual = _canonical_payload(case["encrypted_plaintext_source"])
        assert actual == case["expected_canonical_utf8"]
        assert actual.encode("utf-8").hex() == case["expected_canonical_hex"]
        assert not any(ord(char) < 0x20 for char in actual)


def test_present_defaults_has_four_semantic_fields_only():
    case = FIXTURE["cases"][0]
    assert set(case["encrypted_plaintext_source"]["account_defaults"]) == {
        "schema", "length", "symbols", "policy"
    }
    assert case["server_envelope"]["defaults_state"] == "PRESENT"
    assert len(case["server_envelope"]["defaults_commitment"]) == 64
    semantic_keys = {"schema", "length", "symbols", "policy"}
    conflict = case["encrypted_plaintext_source"]["sync_conflicts"][0]
    for side in ("base", "local", "remote"):
        assert set(conflict[side]) == semantic_keys


def test_absent_defaults_is_null_not_omitted():
    case = FIXTURE["cases"][1]
    assert case["encrypted_plaintext_source"]["account_defaults"] is None
    assert case["server_envelope"]["defaults_state"] == "ABSENT"
    assert case["server_envelope"]["defaults_commitment"] is None
    assert '"account_defaults":null' in case["expected_canonical_utf8"]


def test_independent_envelope_aad_checksum_and_etag():
    for case in FIXTURE["cases"]:
        envelope = case["server_envelope"]
        assert envelope["payload_version"] == 3
        assert envelope["writer_protocol"] == 3
        assert envelope["min_writer_protocol"] == 3
        assert envelope["capabilities"] == ["account_defaults_immutable_v1"]
        assert envelope["aad_hex"] == _aad(envelope)
        assert envelope["checksum"] == hashlib.sha256(bytes.fromhex(envelope["blob_hex"])).hexdigest()
        assert envelope["etag"] == _etag(envelope)


def test_envelope_and_local_only_fields_never_enter_plaintext():
    forbidden = set(FIXTURE["partitions"]["envelope_only"] + FIXTURE["partitions"]["local_only"])
    for case in FIXTURE["cases"]:
        assert _all_keys(case["encrypted_plaintext_source"]).isdisjoint(forbidden)


def test_escaping_edge_is_present_in_literal_bytes():
    expected = FIXTURE["cases"][0]["expected_canonical_utf8"]
    for token in (r"\b", r"\t", r"\n", r"\f", r"\r", "\u2028", "\u2029", "😀", r"\ud800"):
        assert token in expected
