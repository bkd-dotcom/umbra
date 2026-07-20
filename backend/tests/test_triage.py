"""Finding triage lifecycle: store roundtrip + owner isolation + auth gate."""
from fastapi.testclient import TestClient

from backend import main
from backend.store import _MemoryStore

client = TestClient(main.app)

FINDING = "owner/repo:next@14.2.5:GHSA-f82v-jwr5-mffw"


def test_triage_store_roundtrip_and_isolation():
    store = _MemoryStore()
    rec = store.set_triage("github:1", FINDING, "accepted_risk", "dev-only middleware, not exposed", "owner/repo")
    assert rec["status"] == "accepted_risk"
    assert rec["reason"] == "dev-only middleware, not exposed"

    listed = store.list_triage("github:1")
    assert len(listed) == 1 and listed[0]["finding_key"] == FINDING

    # Another user cannot see it.
    assert store.list_triage("github:2") == []

    # Upsert: setting the same finding again updates in place (no duplicate row).
    store.set_triage("github:1", FINDING, "open", None, "owner/repo")
    listed = store.list_triage("github:1")
    assert len(listed) == 1 and listed[0]["status"] == "open"


def test_triage_endpoints_require_auth():
    assert client.get("/api/my/triage").status_code == 401
    assert client.post("/api/my/triage", json={"finding_key": FINDING, "status": "open"}).status_code == 401
