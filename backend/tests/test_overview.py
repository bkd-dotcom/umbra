"""Mission-control overview aggregation (Phase 5 — multi-repo org view).

Pins the /api/my/overview auth gate and the pure build_overview aggregation:
effective authority is honest (a revoked/expired passport counts as L0, never as
the level it once earned) and auto_merge is always false.
"""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from backend.main import app, build_overview

client = TestClient(app)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def test_overview_requires_auth():
    assert client.get("/api/my/overview").status_code == 401


def test_build_overview_counts_effective_authority():
    now = datetime.now(timezone.utc)
    passports = [
        {"repo": "o/live-l2", "authority_level": 2, "authority": "branch_pr",
         "expires_at": _iso(now + timedelta(days=5)), "receipt_hash": "sha256:a"},
        {"repo": "o/analyze", "authority_level": 1, "authority": "analyze",
         "expires_at": _iso(now + timedelta(days=5))},
        {"repo": "o/revoked", "authority_level": 2, "authority": "branch_pr",
         "revoked": True, "expires_at": _iso(now + timedelta(days=5))},
        {"repo": "o/expired", "authority_level": 2, "authority": "branch_pr",
         "expires_at": _iso(now - timedelta(days=1))},
        {"repo": "o/expiring", "authority_level": 2, "authority": "branch_pr",
         "expires_at": _iso(now + timedelta(hours=6))},
    ]
    prs = [{"number": i, "url": f"https://x/pull/{i}"} for i in range(1, 8)]
    scans = [{"umbra_score": 80}, {"umbra_score": 90}, {"umbra_score": 70}]

    o = build_overview(passports=passports, prs=prs, scans=scans)

    # Effective authority: revoked + expired drop to L0; expiring still counts L2.
    assert o["authority_counts"] == {"l0": 2, "l1": 1, "l2": 2}
    assert o["brake"] == {"revoked": 1, "expired": 1, "expiring_soon": 1}
    assert o["repos_enrolled"] == 5
    assert o["prs_opened"] == 7
    assert len(o["recent_prs"]) == 5           # capped at 5
    assert o["avg_umbra_score"] == 80          # (80+90+70)/3
    assert o["scans_saved"] == 3
    assert o["auto_merge"] is False

    by_repo = {r["repo"]: r for r in o["repos"]}
    assert by_repo["o/revoked"]["effective_authority_level"] == 0
    assert by_repo["o/revoked"]["authority_level"] == 2   # original level still shown
    assert by_repo["o/expired"]["expired"] is True
    assert by_repo["o/live-l2"]["effective_authority_level"] == 2
    assert all(r["auto_merge"] is False for r in o["repos"])


def test_build_overview_empty():
    o = build_overview(passports=[], prs=[], scans=[])
    assert o["authority_counts"] == {"l0": 0, "l1": 0, "l2": 0}
    assert o["repos_enrolled"] == 0
    assert o["avg_umbra_score"] is None
    assert o["auto_merge"] is False
