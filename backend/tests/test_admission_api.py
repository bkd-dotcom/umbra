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


# --- Judge-triggerable public LIVE admission (rate-limited, allowlisted) ----------

def test_public_live_repos_list():
    r = client.get("/api/admit/public-live/repos")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["repos"], list) and len(body["repos"]) >= 3
    assert body["per_ip_per_hour"] >= 1


def test_public_live_rejects_non_allowlisted_repo(monkeypatch):
    import backend.main as m

    # Force live enabled so we reach the allowlist check (not the 503 gate).
    monkeypatch.setattr(m, "live_repositories_enabled", lambda: True)
    m._PUBLIC_LIVE_HITS.clear()
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/some/random-repo"})
    assert r.status_code == 400
    assert "enabled for the live demo" in r.json()["detail"]


def test_public_live_rate_limited(monkeypatch):
    import backend.main as m

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: True)
    m._PUBLIC_LIVE_HITS.clear()
    # Saturate the GLOBAL hourly budget so the next call is 429 regardless of IP,
    # before any clone happens.
    now = __import__("time").time()
    m._PUBLIC_LIVE_HITS["10.0.0.1"] = [now] * m._PUBLIC_LIVE_GLOBAL_HOUR
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/expressjs/express"})
    assert r.status_code == 429
    m._PUBLIC_LIVE_HITS.clear()


def test_public_live_disabled_returns_503(monkeypatch):
    import backend.main as m

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: False)
    m._PUBLIC_LIVE_HITS.clear()
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/expressjs/express"})
    assert r.status_code == 503


def test_public_live_codex_requires_cli_enabled(monkeypatch):
    import backend.main as m
    from backend.codex_client import CodexClient

    monkeypatch.setattr(m, "live_repositories_enabled", lambda: True)
    monkeypatch.setattr(CodexClient, "enabled", staticmethod(lambda: False))
    m._PUBLIC_LIVE_HITS.clear(); m._PUBLIC_CODEX_HITS.clear(); m._PUBLIC_CODEX_IP_HITS.clear()
    # codex=true but the server has no Codex CLI → honest 503, no clone attempted.
    r = client.post("/api/admit/public-live", json={"repo_url": "https://github.com/expressjs/express", "codex": True})
    assert r.status_code == 503
    assert "Codex" in r.json()["detail"]


def test_public_live_repos_reports_codex_availability():
    r = client.get("/api/admit/public-live/repos").json()
    assert "codex_available" in r and "codex_per_ip_per_day" in r
