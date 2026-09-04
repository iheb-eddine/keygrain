"""Structural and byte-level checks for the public sync contract fixture."""

import hashlib
import json
import pathlib
import struct


FIXTURE_PATH = pathlib.Path(__file__).resolve().parents[2] / "sync-capability-vectors.json"


def _v3_etag(example):
    state_bytes = {"UNSEALED": 0, "ABSENT": 1, "PRESENT": 2}
    commitment = example["defaults_commitment"] or ""
    blob = bytes.fromhex(example["blob_hex"])
    envelope = b"keygrain-sync-v3-etag\x00"
    envelope += struct.pack(">I", 3)
    envelope += struct.pack(">Q", example["generation"])
    envelope += bytes([state_bytes[example["defaults_state"]]])
    envelope += struct.pack(">I", len(commitment))
    envelope += commitment.encode("ascii")
    envelope += struct.pack(">Q", len(blob))
    envelope += blob
    return hashlib.sha256(envelope).hexdigest()[:32]


def test_sync_capability_fixture_contract():
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    assert fixture["fixture"] == "keygrain-sync-capability-contract"
    assert fixture["fixture_version"] == 1
    assert fixture["status"] == "frozen_public_contract_not_runtime_support_claim"
    assert fixture["capability"] == "account_defaults_immutable_v1"

    protocol = fixture["protocol"]
    legacy = protocol["legacy_v2"]
    strict = protocol["strict_v3"]
    assert legacy["response_body_fields"] == [
        "version",
        "services",
        "encrypted_blob",
        "checksum",
    ]
    assert legacy["response_headers"] == ["ETag"]
    assert "etag" not in legacy["response_body_fields"]
    assert "etag" not in legacy["response_headers"]
    assert strict["get_response_body_fields"] == [
        "version",
        "services",
        "encrypted_blob",
        "checksum",
        "payload_version",
        "min_writer_protocol",
        "capabilities",
        "defaults_state",
        "defaults_commitment",
        "generation",
    ]
    assert strict["put_response_body_fields"] == [
        "services",
        "checksum",
        "etag",
        "payload_version",
        "min_writer_protocol",
        "capabilities",
        "defaults_state",
        "defaults_commitment",
    ]
    assert "etag" not in strict["get_response_body_fields"]
    assert "etag" in strict["put_response_body_fields"]
    assert strict["response_headers"] == ["ETag"]
    assert "etag" not in strict["response_headers"]
    assert strict["request_required"] == [
        "payload_version",
        "writer_protocol",
        "capabilities",
        "defaults_state",
        "defaults_commitment",
    ]
    assert strict["payload_version"] == 3
    assert strict["writer_protocol"] == 3
    assert strict["min_writer_protocol"] == 3
    assert strict["capabilities"] == ["account_defaults_immutable_v1"]
    assert strict["writer_protocol_is_request_only"] is True
    assert strict["min_writer_protocol_is_get_and_record_metadata"] is True
    assert "pending" in strict["runtime_status"]

    get_semantics = fixture["get_response_semantics"]
    for field in (
        "payload_version",
        "min_writer_protocol",
        "capabilities",
        "defaults_state",
        "defaults_commitment",
        "generation",
    ):
        assert isinstance(get_semantics[field], str) and get_semantics[field]

    states = {entry["state"] for entry in fixture["lock_states"]}
    assert states == {"UNSEALED", "ABSENT", "PRESENT"}
    state_entries = {entry["state"]: entry for entry in fixture["lock_states"]}
    assert state_entries["UNSEALED"]["commitment"] is None
    assert state_entries["ABSENT"]["commitment"] is None
    assert state_entries["PRESENT"]["commitment"] == "lowercase 64-hex opaque commitment"
    assert "UNSEALED -> ABSENT or PRESENT" in state_entries["UNSEALED"]["allowed_transition"]
    assert "ABSENT -> ABSENT only" in state_entries["ABSENT"]["allowed_transition"]
    assert "PRESENT -> PRESENT only" in state_entries["PRESENT"]["allowed_transition"]

    request = fixture["put_response_semantics"]["request"]
    assert request["payload_version"] == 3
    assert request["writer_protocol"] == 3
    assert request["capabilities"] == ["account_defaults_immutable_v1"]
    assert request["defaults_state"] == "UNSEALED | ABSENT | PRESENT"
    assert "null" in request["defaults_commitment"]
    assert "64" in request["defaults_commitment"]
    response = fixture["put_response_semantics"]["response"]
    assert "201" in response and "sealed-tombstone recreation" in response
    assert "200" in response and "existing live record" in response

    etag_contract = fixture["etag_contract"]
    assert etag_contract["v2"]["definition"].startswith("lowercase_hex(SHA-256(B)")
    assert "exactly once" in etag_contract["v2"]["boundary"]
    assert etag_contract["v3"]["inputs"]["domain"] == "UTF-8 bytes of keygrain-sync-v3-etag\\0"
    assert etag_contract["v3"]["inputs"]["version"] == "U32BE(3)"
    assert etag_contract["v3"]["inputs"]["generation"] == "U64BE(G)"
    assert etag_contract["v3"]["inputs"]["state_byte"] == "U8(S): UNSEALED=0, ABSENT=1, PRESENT=2"
    assert "zero bytes for UNSEALED/ABSENT" in etag_contract["v3"]["inputs"]["commitment"]
    for example in etag_contract["examples"]:
        assert example["blob_utf8"].encode().hex() == example["blob_hex"]
        assert _v3_etag(example) == example["etag"]
        if example["defaults_state"] == "UNSEALED":
            assert example["defaults_commitment"] is None

    transition = fixture["transition"]
    assert "continue" in transition["old_server"]["legacy_v2_no_defaults"]
    for state in ("defaults_bearing", "legacy_local_defaults_pending"):
        assert "read-only" in transition["old_server"][state]
        assert "write" in transition["old_server"][state].lower() or "PUT" in transition["old_server"][state]
    assert "426" in transition["strict_server"]["old_writer"]
    assert "before record replacement" in transition["strict_server"]["old_writer"]

    errors = {entry["status"]: entry for entry in fixture["error_examples"]}
    assert set(errors) == {409, 422, 426}
    assert errors[426]["body"] == {"error": "upgrade required"}
    assert errors[409]["body"]["error"] == "conflict"
    assert len(errors[409]["body"]["current_etag"]) == 32
    assert errors[422]["body"] == {
        "error": "validation failed",
        "detail": "checksum mismatch",
    }
    for status, error in errors.items():
        assert isinstance(status, int)
        assert error["headers"] == {"Content-Type": "application/json"}
        assert isinstance(error["safety"], str) and error["safety"]
