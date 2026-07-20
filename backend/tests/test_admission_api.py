"""Agent Admission API (Phase 2.4 + P0 hardening): the /api/admit endpoint.

Fixture mode is offline + no-auth so judges and CI can reproduce it. Pins the
endpoint contract: fixture runs return the full report (with enforced checks,
executor label, and proof-binding), unknown fixtures 404, missing input 422.
"""
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_admit_permitted_fixture_returns_branch_pr_authority():
    r = client.post("/api/admit", json={"fixture": "permitted-dependency-fix"})
    assert r.status_code == 200
    body = r.json()
    assert body["authority_level"] == 2 and body["authority"] == "branch_pr"
    assert body["auto_merge"] is False and body["human_review_required"] is True
    assert body["contract_result"]["passed"] is True
    # Honest executor label + enforced checks + bound proof.
    assert body["executor"] == "deterministic"
    assert body["checks"]["ran"] is True and body["checks"]["all_passed"] is True
    assert body["base_commit"] and body["diff_hash"].startswith("sha256:")


def test_admit_adversarial_fixture_quarantines_and_permits():
    r = client.post("/api/admit", json={"fixture": "adversarial-readme-injection"})
    assert r.status_code == 200
    body = r.json()
    assert body["trust_boundary"]["clean"] is False
    assert body["trust_boundary"]["quarantined_count"] >= 1
    assert body["authority_level"] == 2


def test_admit_forbidden_fixture_is_blocked():
    r = client.post("/api/admit", json={"fixture": "forbidden-scope-violation"})
    assert r.status_code == 200
    body = r.json()
    assert body["authority_level"] == 0 and body["authority"] == "observe"
    assert body["contract_result"]["passed"] is False


def test_admit_failing_check_caps_at_analyze():
    r = client.post("/api/admit", json={"fixture": "failing-check-caps-authority"})
    assert r.status_code == 200
    body = r.json()
    assert body["authority_level"] == 1 and body["authority"] == "analyze"
    assert body["checks"]["all_passed"] is False


def test_admit_receipt_binds_proof_and_verifies():
    r = client.post("/api/admit", json={"fixture": "permitted-dependency-fix"})
    env = r.json()["receipt"]
    rec = env["receipt"]
    # The signed payload binds the real artifacts (no nulls for base/diff/advisory).
    assert rec["base_commit"] and rec["diff_hash"] and rec["advisory_hash"]
    assert rec["executor"] == "deterministic" and rec["checks"]["all_passed"] is True
    # And it verifies through the public endpoint.
    v = client.post("/api/receipt/verify", json={"envelope": env}).json()
    assert v["verified"] is True


def test_admit_unknown_fixture_404():
    assert client.post("/api/admit", json={"fixture": "does-not-exist"}).status_code == 404


def test_admit_path_traversal_rejected():
    assert client.post("/api/admit", json={"fixture": "../../backend"}).status_code == 404


def test_admit_requires_input():
    assert client.post("/api/admit", json={}).status_code == 422
