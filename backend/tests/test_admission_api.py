"""Agent Admission API (Phase 2.4): the /api/admit endpoint.

The fixture mode is offline + no-auth so judges and CI can reproduce it. Pins the
endpoint contract: fixture runs return the full report, unknown fixtures 404,
missing input 422.
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


def test_admit_adversarial_fixture_quarantines_and_permits():
    r = client.post("/api/admit", json={"fixture": "adversarial-readme-injection"})
    assert r.status_code == 200
    body = r.json()
    assert body["trust_boundary"]["clean"] is False
    assert body["trust_boundary"]["quarantined_count"] >= 1
    assert body["authority_level"] == 2  # fix still permitted despite the injection


def test_admit_forbidden_fixture_is_blocked():
    r = client.post("/api/admit", json={"fixture": "forbidden-scope-violation"})
    assert r.status_code == 200
    body = r.json()
    assert body["authority_level"] == 0 and body["authority"] == "observe"
    assert body["contract_result"]["passed"] is False


def test_admit_unknown_fixture_404():
    r = client.post("/api/admit", json={"fixture": "does-not-exist"})
    assert r.status_code == 404


def test_admit_path_traversal_rejected():
    r = client.post("/api/admit", json={"fixture": "../../backend"})
    assert r.status_code == 404


def test_admit_requires_input():
    r = client.post("/api/admit", json={})
    assert r.status_code == 422
