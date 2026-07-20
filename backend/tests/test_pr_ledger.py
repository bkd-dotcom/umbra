"""PR ledger: opened-PR receipts store (roundtrip + owner isolation + upsert),
the /api/my/prs auth gate, and the best-effort persist helper that records a
real open (and ignores previews / write-less shapes)."""
from fastapi.testclient import TestClient

from backend import main
from backend.main import PullRequestRequest, _persist_opened_pr
from backend.store import _MemoryStore, set_store

client = TestClient(main.app)


def test_pr_store_roundtrip_isolation_and_upsert():
    store = _MemoryStore()
    pr = {"repo_url": "https://github.com/owner/repo", "number": 7, "url": "https://github.com/owner/repo/pull/7",
          "branch": "umbra/bump-next", "base": "main", "mode": "bump", "package": "next", "cve": "GHSA-x",
          "review": {"risk_score": 20, "severity": "low"}}
    saved = store.save_pr("github:1", pr)
    assert saved["opened_at"]  # stamped server-side

    listed = store.list_prs("github:1")
    assert len(listed) == 1 and listed[0]["number"] == 7 and listed[0]["package"] == "next"

    # Another user cannot see it.
    assert store.list_prs("github:2") == []

    # Upsert: re-opening the SAME (repo_url, number) updates in place, no duplicate row.
    store.save_pr("github:1", {**pr, "branch": "umbra/bump-next-v2"})
    listed = store.list_prs("github:1")
    assert len(listed) == 1 and listed[0]["branch"] == "umbra/bump-next-v2"

    # A different number is a distinct receipt.
    store.save_pr("github:1", {**pr, "number": 8})
    assert len(store.list_prs("github:1")) == 2


def test_my_prs_requires_auth():
    assert client.get("/api/my/prs").status_code == 401


def test_persist_helper_records_real_open_only():
    store = _MemoryStore()
    set_store(store)
    try:
        user = {"provider": "github", "sub": "42"}
        req = PullRequestRequest(repo_url="https://github.com/owner/repo", mode="bump", package="next", version="14.2.5", cve="GHSA-x")
        opened = {"url": "https://github.com/owner/repo/pull/3", "number": 3, "branch": "umbra/bump-next", "base": "main",
                  "review": {"risk_score": 15, "severity": "low"}}

        # A real open is recorded with the advisory + verdict it carried.
        _persist_opened_pr(user, req, opened)
        prs = store.list_prs("github:42")
        assert len(prs) == 1 and prs[0]["number"] == 3 and prs[0]["cve"] == "GHSA-x"
        assert prs[0]["review"]["risk_score"] == 15

        # A preview-shaped result (no url/number) is NOT recorded.
        _persist_opened_pr(user, req, {"preview": True, "files": ["package.json"], "review": {}})
        assert len(store.list_prs("github:42")) == 1

        # No signed-in user → nothing recorded (and no crash).
        _persist_opened_pr(None, req, opened)
        assert len(store.list_prs("github:42")) == 1
    finally:
        set_store(_MemoryStore())  # reset the global store for other tests
