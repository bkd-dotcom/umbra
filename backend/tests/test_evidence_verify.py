"""Evidence-pack verify: recompute the canonical hash and detect tampering."""
from fastapi.testclient import TestClient

from backend import main
from backend.evidence import canonical_hash

client = TestClient(main.app)


def _result():
    return {"umbra_score": 42, "source": "live", "vulnerabilities": [{"cve": "GHSA-x", "severity": "high"}]}


def test_verify_matches_embedded_hash():
    result = _result()
    result["evidence_hash"] = canonical_hash(result)  # canonical_hash excludes evidence_hash
    body = client.post("/api/evidence-pack/verify", json={"result": result}).json()
    assert body["verified"] is True
    assert body["has_claim"] is True
    assert body["computed_hash"] == result["evidence_hash"]


def test_verify_detects_tamper():
    result = _result()
    result["evidence_hash"] = canonical_hash(result)
    result["umbra_score"] = 99  # tamper AFTER hashing
    body = client.post("/api/evidence-pack/verify", json={"result": result}).json()
    assert body["verified"] is False
    assert body["computed_hash"] != body["claimed_hash"]


def test_verify_no_embedded_hash():
    body = client.post("/api/evidence-pack/verify", json={"result": {"umbra_score": 0, "source": "live"}}).json()
    assert body["has_claim"] is False
    assert body["verified"] is False
    assert body["computed_hash"].startswith("sha256:")
