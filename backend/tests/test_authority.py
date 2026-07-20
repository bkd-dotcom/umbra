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


def test_revoke_authority_persists_level_0_and_flag():
    store = _MemoryStore()
    store.save_authority("github:1", "owner/repo", {"authority_level": 2, "authority": "branch_pr"})
    rec = store.revoke_authority("github:1", "owner/repo", reason="looked wrong at 2am")
    assert rec["authority_level"] == 0 and rec["revoked"] is True
    assert rec["revoked_reason"] == "looked wrong at 2am" and rec["auto_merge"] is False
    # Durable: a fresh read still sees the revocation.
    got = store.get_authority("github:1", "owner/repo")
    assert got["revoked"] is True and got["authority_level"] == 0


def test_revoke_authority_on_unknown_repo_creates_revoked_record():
    store = _MemoryStore()
    rec = store.revoke_authority("github:1", "never/admitted")
    assert rec["revoked"] is True and rec["authority_level"] == 0


def test_revoke_endpoint_requires_auth():
    assert client.post("/api/my/authority/revoke", json={"repo": "o/r"}).status_code == 401


def test_persist_authority_binds_receipt_and_run():
    """The persisted passport binds the exact admission: receipt hash, base commit,
    executor/config hash, check result, and an expiry."""
    from backend import main
    from backend.store import _MemoryStore, set_store

    store = _MemoryStore()
    set_store(store)
    try:
        user = {"provider": "github", "sub": "7"}
        report = {
            "repo": "owner/repo", "authority_level": 2, "authority": "branch_pr",
            "task_type": "dependency-remediation", "executor": "codex-cli",
            "base_commit": "abc123def456", "diff_hash": "sha256:dd", "advisory_hash": "sha256:aa",
            "contract_result": {"contract_hash": "sha256:cc"},
            "checks": {"enforcement": "sandboxed", "all_passed": True},
            "codex_config": {"config_hash": "sha256:xx"},
            "receipt": {"canonical_hash": "sha256:rr"},
        }
        main._persist_authority(user, report)
        p = store.get_authority("github:7", "owner/repo")
        assert p["receipt_hash"] == "sha256:rr" and p["base_commit"] == "abc123def456"
        assert p["executor"] == "codex-cli" and p["codex_config_hash"] == "sha256:xx"
        assert p["checks_enforcement"] == "sandboxed" and p["checks_all_passed"] is True
        assert p["admitted_at"] and p["expires_at"] and p["expires_at"] > p["admitted_at"]
    finally:
        set_store(_MemoryStore())


def test_pr_authority_gate_blocks_revoked_or_low_authority():
    """The PR-open gate (_enforce_pr_authority) is the real server-side enforcement:
    a revoked or below-L2 passport blocks a PR; no passport leaves crew flows alone."""
    import fastapi

    from backend import main
    from backend.store import _MemoryStore, set_store

    store = _MemoryStore()
    set_store(store)
    try:
        user = {"provider": "github", "sub": "1"}
        url = "https://github.com/owner/repo"

        # No passport → gate does not apply (no exception).
        main._enforce_pr_authority(user, url)

        # Earned L2 → allowed.
        store.save_authority("github:1", "owner/repo", {"authority_level": 2, "authority": "branch_pr"})
        main._enforce_pr_authority(user, url)

        # Revoked (Emergency Brake) → blocked with 403.
        store.revoke_authority("github:1", "owner/repo", reason="brake")
        try:
            main._enforce_pr_authority(user, url)
            assert False, "expected revoked authority to block the PR"
        except fastapi.HTTPException as exc:
            assert exc.status_code == 403 and "revoked" in exc.detail.lower()

        # Re-admitted below L2 → still blocked.
        store.save_authority("github:1", "owner/repo", {"authority_level": 1, "authority": "analyze"})
        try:
            main._enforce_pr_authority(user, url)
            assert False, "expected sub-L2 authority to block the PR"
        except fastapi.HTTPException as exc:
            assert exc.status_code == 403
    finally:
        set_store(_MemoryStore())


def test_pr_authority_strict_mode_blocks_unenrolled_repo(monkeypatch):
    """UMBRA_REQUIRE_ADMISSION=true → a repo with no passport is blocked."""
    import fastapi

    from backend import main
    from backend.store import _MemoryStore, set_store

    set_store(_MemoryStore())
    monkeypatch.setenv("UMBRA_REQUIRE_ADMISSION", "true")
    try:
        try:
            main._enforce_pr_authority({"provider": "github", "sub": "1"}, "https://github.com/owner/repo")
            assert False, "strict mode should block an unadmitted repo"
        except fastapi.HTTPException as exc:
            assert exc.status_code == 403 and "not been admitted" in exc.detail.lower()
    finally:
        set_store(_MemoryStore())


def test_pr_authority_blocks_expired_passport():
    import fastapi

    from backend import main
    from backend.store import _MemoryStore, set_store

    store = _MemoryStore()
    set_store(store)
    try:
        store.save_authority("github:1", "owner/repo", {"authority_level": 2, "authority": "branch_pr", "expires_at": "2000-01-01T00:00:00+00:00"})
        try:
            main._enforce_pr_authority({"provider": "github", "sub": "1"}, "https://github.com/owner/repo")
            assert False, "expected expired passport to block the PR"
        except fastapi.HTTPException as exc:
            assert exc.status_code == 403 and "expired" in exc.detail.lower()
    finally:
        set_store(_MemoryStore())


