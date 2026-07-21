"""Scheduled scans + emailed morning reports (Workstream D)."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.notifications import make_unsub_token, read_unsub_token, send_report_email
from backend.scheduling import compute_next_run, valid_timezone
from backend.store import _MemoryStore, set_store

client = TestClient(main.app)


# --- compute_next_run -------------------------------------------------------
def test_compute_next_run_daily_tz():
    # 2026-07-18 20:00 UTC is 16:00 EDT (Sat); next 09:30 EDT is Sun the 19th.
    nr = compute_next_run(9, 30, "America/New_York", "daily", datetime(2026, 7, 18, 20, 0, tzinfo=timezone.utc))
    assert nr == "2026-07-19T13:30:00+00:00"


def test_compute_next_run_weekdays_skips_weekend():
    # From Sat afternoon, weekdays cadence must skip Sunday → Monday.
    nr = compute_next_run(9, 30, "America/New_York", "weekdays", datetime(2026, 7, 18, 20, 0, tzinfo=timezone.utc))
    assert nr == "2026-07-20T13:30:00+00:00"


def test_compute_next_run_rejects_bad_inputs():
    now = datetime(2026, 7, 18, tzinfo=timezone.utc)
    with pytest.raises(ValueError):
        compute_next_run(25, 0, "UTC", "daily", now)
    with pytest.raises(ValueError):
        compute_next_run(9, 0, "UTC", "hourly", now)
    with pytest.raises(ValueError):
        compute_next_run(9, 0, "Mars/Olympus", "daily", now)
    assert valid_timezone("Europe/London") and not valid_timezone("Nope/Nope")


# --- store roundtrip --------------------------------------------------------
def test_schedule_store_roundtrip_and_due_filter():
    store = _MemoryStore()
    saved = store.save_schedule("github:1", {"repo_full_name": "u/r", "hour": 9, "minute": 0, "timezone": "UTC", "cadence": "daily", "email": "a@b.com", "enabled": True, "next_run_at": "2020-01-01T00:00:00+00:00"})
    assert saved["id"] and store.list_schedules("github:1")[0]["repo_full_name"] == "u/r"
    # Another user can't see it.
    assert store.list_schedules("github:2") == []
    # Due because next_run_at is in the past.
    due = store.list_due_schedules(datetime.now(timezone.utc).isoformat())
    assert any(d["id"] == saved["id"] for d in due)
    # Disabling removes it from the due set.
    store.set_schedule_enabled("github:1", saved["id"], False)
    assert all(d["id"] != saved["id"] for d in store.list_due_schedules(datetime.now(timezone.utc).isoformat()))
    # Delete is owner-scoped.
    store.delete_schedule("github:2", saved["id"])  # wrong owner → no-op
    assert store.list_schedules("github:1")
    store.delete_schedule("github:1", saved["id"])
    assert store.list_schedules("github:1") == []


def test_notifications_opt_out_roundtrip():
    store = _MemoryStore()
    assert store.notifications_opt_out("github:1") is False
    store.set_notifications_opt_out("github:1", True)
    assert store.notifications_opt_out("github:1") is True


# --- email + unsubscribe token ---------------------------------------------
def test_unsub_token_roundtrip():
    assert read_unsub_token(make_unsub_token("github:42")) == "github:42"
    assert read_unsub_token("tampered") is None


def test_send_report_email_degrades_when_unconfigured(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    assert send_report_email("x@y.com", "a/b", {"umbra_score": 80, "vulnerabilities": []}, "http://x", "http://u") is False


# --- cron endpoint ----------------------------------------------------------
def test_cron_requires_configuration(monkeypatch):
    monkeypatch.delenv("UMBRA_CRON_KEY", raising=False)
    assert client.post("/api/cron/run-due-scans").status_code == 503


def test_cron_rejects_bad_key(monkeypatch):
    monkeypatch.setenv("UMBRA_CRON_KEY", "s3cret")
    assert client.post("/api/cron/run-due-scans", headers={"X-Umbra-Cron-Key": "wrong"}).status_code == 401


def test_cron_runs_due_scan_and_advances(monkeypatch):
    monkeypatch.setenv("UMBRA_CRON_KEY", "s3cret")
    monkeypatch.setenv("RESEND_API_KEY", "re_test")  # email configured so a report is attempted
    store = _MemoryStore()
    set_store(store)
    saved = store.save_schedule("github:1", {"repo_full_name": "u/r", "hour": 9, "minute": 0, "timezone": "UTC", "cadence": "daily", "email": "a@b.com", "enabled": True, "next_run_at": "2020-01-01T00:00:00+00:00"})

    async def fake_scan(url, **kw):
        return {"umbra_score": 91, "vulnerabilities": [], "source": "scheduled"}

    sent: list[str] = []
    monkeypatch.setattr(main.orchestrator, "scan", fake_scan)
    monkeypatch.setattr(main, "send_report_email", lambda *a, **k: sent.append(a[0]) or True)

    resp = client.post("/api/cron/run-due-scans", headers={"X-Umbra-Cron-Key": "s3cret"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ran"] == 1 and body["emailed"] == 1 and sent == ["a@b.com"]
    # The scan was saved and the schedule's next_run_at advanced into the future.
    assert store.list_scans("github:1") and store.list_scans("github:1")[0]["report"]["umbra_score"] == 91
    advanced = store.list_schedules("github:1")[0]["next_run_at"]
    assert advanced > datetime.now(timezone.utc).isoformat()
    set_store(_MemoryStore())  # reset global for other tests


def test_cron_skips_email_when_opted_out(monkeypatch):
    monkeypatch.setenv("UMBRA_CRON_KEY", "s3cret")
    store = _MemoryStore()
    set_store(store)
    store.save_schedule("github:9", {"repo_full_name": "u/r", "hour": 9, "minute": 0, "timezone": "UTC", "cadence": "daily", "email": "a@b.com", "enabled": True, "next_run_at": "2020-01-01T00:00:00+00:00"})
    store.set_notifications_opt_out("github:9", True)

    async def fake_scan(url, **kw):
        return {"umbra_score": 70, "vulnerabilities": [], "source": "scheduled"}

    monkeypatch.setattr(main.orchestrator, "scan", fake_scan)
    monkeypatch.setattr(main, "send_report_email", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not email an opted-out user")))
    body = client.post("/api/cron/run-due-scans", headers={"X-Umbra-Cron-Key": "s3cret"}).json()
    assert body["ran"] == 1 and body["emailed"] == 0
    set_store(_MemoryStore())


def test_schedule_endpoints_require_auth():
    assert client.get("/api/my/schedules").status_code == 401
    assert client.post("/api/my/schedules", json={"repo_full_name": "u/r", "hour": 9, "timezone": "UTC"}).status_code == 401


def test_unsubscribe_page_handles_bad_token():
    r = client.get("/api/unsubscribe", params={"token": "nope"})
    assert r.status_code == 400 and "invalid" in r.text.lower()
