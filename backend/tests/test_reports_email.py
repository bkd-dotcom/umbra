"""Immediate on-demand email of an EXISTING saved report + scheduled-run
delivery-status persistence (honest delivery states).

The endpoint never scans and never invents a report — it only re-sends a report
the user already has. The provider (Resend / send_report_email) is always mocked;
nothing here touches the network.
"""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend import main, schedules
from backend.notifications import (
    DELIVERY_ACCEPTED,
    DELIVERY_EMAIL_REJECTED,
)
from backend.store import _MemoryStore, set_store

client = TestClient(main.app)


def _login(monkeypatch, sub="1", provider="github", email="me@example.com"):
    """Make the endpoint see an authenticated user without a real OAuth flow.

    Endpoints call the module-local ``get_current_user`` reference, so patch that.
    Returns the user_key the store is keyed by."""
    user = {"sub": sub, "provider": provider, "name": "Dev", "email": email}
    monkeypatch.setattr(schedules, "get_current_user", lambda request: dict(user))
    return f"{provider}:{sub}"


def _saved_scan(store, key, repo="owner/repo", score=88):
    store.save_scan(key, {
        "repo_full_name": repo,
        "umbra_score": score,
        "source": "manual",
        "vuln_count": 0,
        "report": {"umbra_score": score, "vulnerabilities": [], "reasoning_summary": "clean"},
    })
    return store.list_scans(key, limit=1)[0]


# --- immediate send ---------------------------------------------------------
def test_email_saved_report_success_is_accepted(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")  # email configured
    store = _MemoryStore()
    set_store(store)
    key = _login(monkeypatch)
    _saved_scan(store, key, "owner/repo")

    sent: list[tuple] = []
    monkeypatch.setattr(schedules, "send_report_email", lambda *a, **k: sent.append(a) or True)

    r = client.post("/api/my/reports/email", json={"repo": "owner/repo"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "accepted_for_delivery"
    assert body["recipient"] == "me@example.com" and body["repo"] == "owner/repo"
    # The recipient + repo were passed to the (mocked) provider — no scan happened.
    assert sent and sent[0][0] == "me@example.com" and sent[0][1] == "owner/repo"
    set_store(_MemoryStore())


def test_email_saved_report_by_scan_id(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    store = _MemoryStore()
    set_store(store)
    key = _login(monkeypatch)
    scan = _saved_scan(store, key, "owner/repo")
    monkeypatch.setattr(schedules, "send_report_email", lambda *a, **k: True)

    r = client.post("/api/my/reports/email", json={"scan_id": scan["scan_id"]})
    assert r.status_code == 200 and r.json()["status"] == "accepted_for_delivery"
    set_store(_MemoryStore())


def test_email_no_saved_report_is_404(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    store = _MemoryStore()
    set_store(store)
    _login(monkeypatch)
    monkeypatch.setattr(schedules, "send_report_email", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not send when there is no saved report")))

    r = client.post("/api/my/reports/email", json={"repo": "owner/never-scanned"})
    assert r.status_code == 404 and "no saved report" in r.json()["detail"].lower()
    set_store(_MemoryStore())


def test_email_cannot_reach_another_users_report(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    store = _MemoryStore()
    set_store(store)
    # User A owns a scan; user B is authenticated and must not be able to email it.
    other_scan = _saved_scan(store, "github:999", "secret/repo")
    _login(monkeypatch, sub="1")  # user B
    monkeypatch.setattr(schedules, "send_report_email", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not send another user's report")))

    # By repo name — not in B's history → 404.
    r1 = client.post("/api/my/reports/email", json={"repo": "secret/repo"})
    assert r1.status_code == 404
    # By the other user's scan_id — owner-scoped lookup returns nothing → 404.
    r2 = client.post("/api/my/reports/email", json={"scan_id": other_scan["scan_id"]})
    assert r2.status_code == 404
    set_store(_MemoryStore())


def test_email_blocked_when_opted_out(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    store = _MemoryStore()
    set_store(store)
    key = _login(monkeypatch)
    _saved_scan(store, key, "owner/repo")
    store.set_notifications_opt_out(key, True)
    monkeypatch.setattr(schedules, "send_report_email", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not send to an opted-out user")))

    r = client.post("/api/my/reports/email", json={"repo": "owner/repo"})
    assert r.status_code == 409
    assert "turned off" in r.json()["detail"].lower() and "re-enable" in r.json()["detail"].lower()
    set_store(_MemoryStore())


def test_email_not_configured_is_clear_error(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)  # email NOT configured
    store = _MemoryStore()
    set_store(store)
    key = _login(monkeypatch)
    _saved_scan(store, key, "owner/repo")
    monkeypatch.setattr(schedules, "send_report_email", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not attempt send when unconfigured")))

    r = client.post("/api/my/reports/email", json={"repo": "owner/repo"})
    assert r.status_code == 503 and "isn't configured" in r.json()["detail"]
    set_store(_MemoryStore())


def test_email_provider_rejection_is_not_success(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    store = _MemoryStore()
    set_store(store)
    key = _login(monkeypatch)
    _saved_scan(store, key, "owner/repo")
    # Provider returns False (rejection / send failure) — must surface as 502, never "accepted".
    monkeypatch.setattr(schedules, "send_report_email", lambda *a, **k: False)

    r = client.post("/api/my/reports/email", json={"repo": "owner/repo"})
    assert r.status_code == 502
    assert "rejected" in r.json()["detail"].lower()
    set_store(_MemoryStore())


def test_email_requires_auth():
    assert client.post("/api/my/reports/email", json={"repo": "owner/repo"}).status_code == 401


# --- scheduled-run delivery status persistence ------------------------------
def _due_schedule(store, key, email="a@b.com"):
    return store.save_schedule(key, {
        "repo_full_name": "u/r", "hour": 9, "minute": 0, "timezone": "UTC",
        "cadence": "daily", "email": email, "enabled": True,
        "next_run_at": "2020-01-01T00:00:00+00:00",
    })


def test_scheduled_run_records_acceptance(monkeypatch):
    monkeypatch.setenv("UMBRA_CRON_KEY", "s3cret")
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    store = _MemoryStore()
    set_store(store)
    saved = _due_schedule(store, "github:1")

    async def fake_scan(url, **kw):
        return {"umbra_score": 91, "vulnerabilities": [], "source": "scheduled"}

    monkeypatch.setattr(main.orchestrator, "scan", fake_scan)
    monkeypatch.setattr(main, "send_report_email", lambda *a, **k: True)

    r = client.post("/api/cron/run-due-scans", headers={"X-Umbra-Cron-Key": "s3cret"})
    assert r.status_code == 200 and r.json()["emailed"] == 1
    sched = store.list_schedules("github:1")[0]
    assert sched["last_delivery_status"] == DELIVERY_ACCEPTED
    assert sched["last_scan_id"]  # deep-linkable to the saved report
    set_store(_MemoryStore())


def test_scheduled_run_records_rejection(monkeypatch):
    monkeypatch.setenv("UMBRA_CRON_KEY", "s3cret")
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    store = _MemoryStore()
    set_store(store)
    _due_schedule(store, "github:2")

    async def fake_scan(url, **kw):
        return {"umbra_score": 40, "vulnerabilities": [], "source": "scheduled"}

    monkeypatch.setattr(main.orchestrator, "scan", fake_scan)
    monkeypatch.setattr(main, "send_report_email", lambda *a, **k: False)  # provider rejects

    r = client.post("/api/cron/run-due-scans", headers={"X-Umbra-Cron-Key": "s3cret"})
    body = r.json()
    assert r.status_code == 200 and body["ran"] == 1 and body["emailed"] == 0
    sched = store.list_schedules("github:2")[0]
    # A failed email is visible, never silently successful.
    assert sched["last_delivery_status"] == DELIVERY_EMAIL_REJECTED
    # The schedule still advanced so it doesn't immediately re-fire.
    assert sched["next_run_at"] > datetime.now(timezone.utc).isoformat()
    set_store(_MemoryStore())


def test_update_schedule_run_delivery_status_is_optional():
    """Existing callers that omit the delivery status stay valid (back-compat)."""
    store = _MemoryStore()
    saved = store.save_schedule("github:1", {"repo_full_name": "u/r", "enabled": True, "next_run_at": "2020-01-01T00:00:00+00:00"})
    store.update_schedule_run(saved["id"], "2026-01-01T00:00:00+00:00", "2026-01-02T00:00:00+00:00", None)
    rec = store.list_schedules("github:1")[0]
    assert rec["last_run_at"] == "2026-01-01T00:00:00+00:00"
    assert "last_delivery_status" not in rec  # not set when omitted
    store.update_schedule_run(saved["id"], "2026-01-03T00:00:00+00:00", "2026-01-04T00:00:00+00:00", "sc1", delivery_status=DELIVERY_ACCEPTED, delivery_detail="ok")
    rec = store.list_schedules("github:1")[0]
    assert rec["last_delivery_status"] == DELIVERY_ACCEPTED and rec["last_scan_id"] == "sc1"
