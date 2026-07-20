"""Earned-authority passport (Phase 2.5): durable, revocable, per-repo authority.

Pins the store roundtrip (upsert + owner isolation + downgrade), the
auto_merge-always-false invariant, and the /api/my/authority auth gate.
"""
from fastapi.testclient import TestClient

from backend.main import app
from backend.store import _MemoryStore

client = TestClient(app)


def test_authority_roundtrip_and_upsert_and_isolation():
    store = _MemoryStore()
    p = store.save_authority("github:1", "owner/repo", {"authority_level": 2, "authority": "branch_pr", "outcome": "ok"})
    assert p["auto_merge"] is False and p["updated_at"]
    got = store.get_authority("github:1", "owner/repo")
    assert got and got["authority_level"] == 2 and got["authority"] == "branch_pr"

    # Another user can't see it.
    assert store.get_authority("github:2", "owner/repo") is None
    assert store.list_authority("github:2") == []

    # Re-running admission downgrades in place (revocable) — no duplicate row.
    store.save_authority("github:1", "owner/repo", {"authority_level": 0, "authority": "observe", "outcome": "blocked"})
    assert store.get_authority("github:1", "owner/repo")["authority_level"] == 0
    assert len(store.list_authority("github:1")) == 1

    # A different repo is a distinct passport.
    store.save_authority("github:1", "owner/other", {"authority_level": 1, "authority": "analyze"})
    assert len(store.list_authority("github:1")) == 2


def test_authority_never_stores_auto_merge_true():
    store = _MemoryStore()
    # Even if a caller tries to smuggle auto_merge=True, it's forced false.
    p = store.save_authority("github:1", "o/r", {"authority_level": 2, "auto_merge": True})
    assert p["auto_merge"] is False
    assert store.get_authority("github:1", "o/r")["auto_merge"] is False


def test_my_authority_requires_auth():
    assert client.get("/api/my/authority").status_code == 401
