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


# --- Judge-triggerable public LIVE admission (catalog + quota model) --------------

def _reset_quota(m):
    m._DET_HITS.clear()
    m._CODEX_HITS.clear()
    m._CODEX_IP_HITS.clear()
    m._CODEX_INFLIGHT.clear()


def test_public_live_catalog_shape_and_matches_allowlist():
    from backend.public_catalog import DETERMINISTIC_ALLOWLIST

    body = client.get("/api/admit/public-live/repos").json()
    assert isinstance(body["entries"], list) and body["entries"]
    # Back-compat flat fields still present.
    assert isinstance(body["repos"], list) and body["per_ip_per_hour"] >= 1
    assert "codex_available" in body and "codex_per_ip_per_day" in body
    assert "codex_remaining_for_you" in body and "codex_remaining_global" in body
    # Every deterministic_live entry the catalog advertises is in the allowlist the
    # endpoint actually accepts — one source of truth, no drift.
    for e in body["entries"]:
        assert e["mode"] in {"captured", "deterministic_live", "founder_codex", "unavailable"}
        if e["mode"] == "deterministic_live":
            owner_repo = e["repo_url"].removeprefix("https://github.com/")
            assert f"github.com/{owner_repo}" in DETERMINISTIC_ALLOWLIST
    # A captured entry must carry a proof id and never consume quota.
    captured = [e for e in body["entries"] if e["mode"] == "captured"]
    assert captured and all(c["captured_proof_id"] and c["consumes_quota"] is False for c in captured)


def test_public_live_rejects_non_allowlisted_repo(monkeypatch):
    import backend.main as m

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: True)
    _reset_quota(m)
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/some/random-repo"})
    assert r.status_code == 400
    assert "catalog" in r.json()["detail"].lower()


def test_public_live_disabled_returns_503(monkeypatch):
    import backend.main as m

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: False)
    _reset_quota(m)
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/expressjs/express"})
    assert r.status_code == 503


def test_deterministic_rate_limited(monkeypatch):
    import backend.main as m

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: True)
    _reset_quota(m)
    now = __import__("time").time()
    # Saturate the global deterministic budget → next call is 429 before any clone.
    m._DET_HITS["10.0.0.1"] = [now] * m.DETERMINISTIC_GLOBAL_PER_HOUR
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/expressjs/express"})
    assert r.status_code == 429
    _reset_quota(m)


def test_public_live_codex_requires_cli_enabled(monkeypatch):
    import backend.main as m
    from backend.codex_client import CodexClient

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: True)
    monkeypatch.setattr(CodexClient, "enabled", staticmethod(lambda: False))
    _reset_quota(m)
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/expressjs/express", "codex": True})
    assert r.status_code == 503
    assert "Codex" in r.json()["detail"]


def test_invalid_repo_does_not_charge_codex_quota(monkeypatch):
    import backend.main as m
    from backend.codex_client import CodexClient

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: True)
    monkeypatch.setattr(CodexClient, "enabled", staticmethod(lambda: True))
    _reset_quota(m)
    before = client.get("/api/admit/public-live/repos").json()["codex_remaining_for_you"]
    # Malformed repo → 422/400 with codex=true; must NOT decrement the Codex quota.
    r = client.post("/api/admit/public-live", json={"repo_url": "not a url", "codex": True})
    assert r.status_code in (400, 422)
    after = client.get("/api/admit/public-live/repos").json()["codex_remaining_for_you"]
    assert after == before
    _reset_quota(m)


def test_rejected_repo_does_not_charge_codex_quota(monkeypatch):
    import backend.main as m
    from backend.codex_client import CodexClient

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: True)
    monkeypatch.setattr(CodexClient, "enabled", staticmethod(lambda: True))
    _reset_quota(m)
    before = client.get("/api/admit/public-live/repos").json()["codex_remaining_for_you"]
    # Valid GitHub URL but not in the catalog → 400; must NOT charge Codex quota.
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/torvalds/linux", "codex": True})
    assert r.status_code == 400
    after = client.get("/api/admit/public-live/repos").json()["codex_remaining_for_you"]
    assert after == before
    _reset_quota(m)


def test_codex_is_founder_only_for_anonymous(monkeypatch):
    import backend.main as m
    from backend.codex_client import CodexClient

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: True)
    monkeypatch.setattr(CodexClient, "enabled", staticmethod(lambda: True))
    _reset_quota(m)
    before = client.get("/api/admit/public-live/repos").json()["codex_remaining_for_you"]
    # Anonymous (no founder session) genuine-Codex request → 403, and NO quota spent.
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/expressjs/express", "codex": True})
    assert r.status_code == 403
    assert "founder-only" in r.json()["detail"].lower()
    after = client.get("/api/admit/public-live/repos").json()["codex_remaining_for_you"]
    assert after == before
    _reset_quota(m)


def test_codex_charged_only_when_exhausted_blocks(monkeypatch):
    import backend.main as m
    from backend.codex_client import CodexClient

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: True)
    monkeypatch.setattr(CodexClient, "enabled", staticmethod(lambda: True))
    monkeypatch.setattr(m, "_is_founder", lambda req: True)  # reach the quota logic
    _reset_quota(m)
    # Pre-exhaust the per-IP daily Codex budget for the test client's IP.
    now = __import__("time").time()
    m._CODEX_IP_HITS["testclient"] = [now] * m.CODEX_PER_IP_PER_DAY
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/expressjs/express", "codex": True})
    assert r.status_code == 429
    assert "captured" in r.json()["detail"].lower()
    _reset_quota(m)


def test_inflight_codex_run_blocks_duplicate(monkeypatch):
    import backend.main as m
    from backend.codex_client import CodexClient

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: True)
    monkeypatch.setattr(CodexClient, "enabled", staticmethod(lambda: True))
    monkeypatch.setattr(m, "_is_founder", lambda req: True)  # reach the in-flight guard
    _reset_quota(m)
    # Simulate a run already in flight for this IP → duplicate must 409, not charge.
    m._CODEX_INFLIGHT.add("testclient")
    before = client.get("/api/admit/public-live/repos").json()["codex_remaining_for_you"]
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/expressjs/express", "codex": True})
    assert r.status_code == 409
    after = client.get("/api/admit/public-live/repos").json()["codex_remaining_for_you"]
    assert after == before
    _reset_quota(m)


# --- Repo URL normalization (root cause of "only acceptable GitHub repos") --------

def test_parse_public_repo_accepts_common_forms():
    from backend.integrations.github import parse_public_repo

    for value in [
        "https://github.com/expressjs/express",
        "http://github.com/expressjs/express",
        "github.com/expressjs/express",          # scheme-less (was rejected before)
        "www.github.com/expressjs/express",
        "expressjs/express",                      # bare owner/repo
        "https://github.com/expressjs/express.git",
        "https://github.com/expressjs/express/",
    ]:
        assert parse_public_repo(value) == "expressjs/express", value


def test_parse_public_repo_rejects_non_github_and_malformed():
    import pytest

    from backend.integrations.github import parse_public_repo

    for bad in ["https://gitlab.com/a/b", "not a url", "https://github.com/onlyowner"]:
        with pytest.raises(ValueError):
            parse_public_repo(bad)
